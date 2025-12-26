# backend/app/api/v1/db_router.py
from __future__ import annotations

import io
import os
import sys
import time
import uuid
import threading
import traceback
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.google_creds_bootstrap import ensure_gcp_creds_file
from backend.app.utils.db.core import SyncEngine
from backend.app.utils.db.dbsync.postgres_adapter import PostgresAdapter
from backend.app.utils.db.dbsync.sheets_adapter import SheetsAdapter


# ------------------------------
# PRIORITY (orden estricto)
# ------------------------------
PRIORITY = [
    "public.users",
    "public.tipo_segmentos_gasto",
    "public.tipo_ramas_proveedores",
    "public.tipo_ramas_gasto",
    "public.tipo_ingreso",
    "public.tipo_gasto",
    "public.proveedores",
    "public.cuentas_bancarias",
    "public.patrimonio",
    "public.patrimonio_compra",
    "public.ingresos",
    "public.gastos",
    "public.gastos_cotidianos",
    "public.cierre_mensual",
    "public.cierre_mensual_detalle",
    "public.log_general",
    "public.prestamo",
    "public.prestamo_cuota",
    # puedes ampliar con el resto si quieres
]
PRIORITY_SET = set(PRIORITY)


def enforce_strict_priority(candidates: List[str]) -> List[str]:
    """
    Orden:
      1) Todo lo que esté en PRIORITY, respetando el orden PRIORITY.
      2) El resto (no-priority) al final, manteniendo el orden original.
    """
    cand_set = set(candidates)
    head = [t for t in PRIORITY if t in cand_set]
    tail = [t for t in candidates if t not in PRIORITY_SET]
    return list(dict.fromkeys(head + tail))


# ------------------------------
# Router
# ------------------------------
# OJO: este router se incluye con prefix="/api/v1" (según tu main),
# por eso la ruta final será /api/v1/db/...
router = APIRouter(prefix="/db", tags=["db"])


# ------------------------------
# Modelos
# ------------------------------
class SyncStartRequest(BaseModel):
    source: str = Field(..., pattern="^(neon|supabase|sheets)$")
    dest: str = Field(..., pattern="^(neon|supabase|sheets)$")
    execute: bool = True
    allow_destructive: bool = False
    tables: Optional[List[str]] = None
    exclude: Optional[List[str]] = None


class SyncStatusResponse(BaseModel):
    job_id: str
    status: str  # queued|running|done|error|canceled
    progress: float
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    log_tail: str
    error: Optional[str] = None
    current_table: Optional[str] = None
    total_tables: Optional[int] = None
    processed_tables: Optional[int] = None


# ------------------------------
# Job store (memoria)
# ------------------------------
class Job:
    def __init__(self, payload: SyncStartRequest):
        self.id = uuid.uuid4().hex[:12]
        self.payload = payload
        self.status = "queued"
        self.started_at: Optional[float] = None
        self.ended_at: Optional[float] = None
        self.progress: float = 0.0
        self.log_buf = io.StringIO()
        self.error: Optional[str] = None
        self.current_table: Optional[str] = None
        self.total_tables: Optional[int] = None
        self.processed_tables: Optional[int] = None
        self._cancel = False

    def write_log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        self.log_buf.write(f"[{ts}] {msg}\n")
        self.log_buf.flush()

    def tail(self, max_chars: int = 3000) -> str:
        v = self.log_buf.getvalue()
        return v[-max_chars:] if len(v) > max_chars else v


JOBS: Dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


# ------------------------------
# Helpers de env / URL
# ------------------------------
def _get_env(name: str) -> str:
    """
    Lee env, y elimina comillas accidentales (muy típico en Render/CI).
    """
    v = os.getenv(name, "")
    return v.strip().strip('"').strip("'")


def _sanitize_psycopg_url(url: str) -> str:
    """
    Previene el error:
      TypeError: '>=' not supported between instances of 'int' and 'str'

    Causa típica:
      ...?prepare_threshold=0  (en URL) => psycopg lo recibe como string "0"
      pero espera int.

    Solución:
      - eliminamos prepare_threshold del DSN
      - el adapter lo inyecta como connect_arg int: prepare_threshold=0
    """
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

    try:
        parts = urlsplit(url)
        q = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True) if k != "prepare_threshold"]
        new_query = urlencode(q, doseq=True)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    except Exception:
        # si no podemos parsear, devolvemos original
        return url


# ------------------------------
# Adapters factory
# ------------------------------
def make_adapter(name: str):
    name = (name or "").lower().strip()

    if name == "neon":
        url = _get_env("DB_URL_NEON")
        if not url:
            raise HTTPException(status_code=500, detail="DB_URL_NEON no está configurada")
        url = _sanitize_psycopg_url(url)
        return PostgresAdapter(url)

    if name == "supabase":
        url = _get_env("DB_URL_SUPABASE")
        if not url:
            raise HTTPException(status_code=500, detail="DB_URL_SUPABASE no está configurada")
        url = _sanitize_psycopg_url(url)
        return PostgresAdapter(url)

    if name == "sheets":
        # Materializa credenciales si vienen por GOOGLE_CREDENTIALS_JSON (Render)
        ensure_gcp_creds_file()

        sid = _get_env("GOOGLE_SHEETS_ID")
        creds = _get_env("GOOGLE_APPLICATION_CREDENTIALS")

        if not sid:
            raise HTTPException(status_code=500, detail="GOOGLE_SHEETS_ID no está configurada")
        if not creds:
            raise HTTPException(status_code=500, detail="GOOGLE_APPLICATION_CREDENTIALS no está configurada")

        return SheetsAdapter(spreadsheet_id=sid, creds_path=creds)

    raise HTTPException(status_code=400, detail=f"Adapter desconocido: {name}")


# ------------------------------
# Runner del job
# ------------------------------
def _run_job(job: Job):
    job.status = "running"
    job.started_at = time.time()
    payload = job.payload

    # Capturamos prints del engine/adapters en el buffer del job
    old_stdout = sys.stdout
    sys.stdout = job.log_buf

    try:
        if payload.source == payload.dest:
            raise RuntimeError("source y dest no pueden ser iguales")

        src = make_adapter(payload.source)
        dst = make_adapter(payload.dest)

        # 1) Tablas candidatas: desde source
        all_tables = src.list_tables()

        # filtro opcional tables (acepta full_name o nombre sin schema)
        if payload.tables:
            wanted = set(payload.tables)
            target = [t for t in all_tables if (t in wanted or t.split(".", 1)[-1] in wanted)]
        else:
            target = all_tables

        # exclude opcional
        if payload.exclude:
            ex = set(payload.exclude)
            target = [t for t in target if (t not in ex and t.split(".", 1)[-1] not in ex)]

        # por defecto: solo public.*
        target = [t for t in target if t.startswith("public.")]

        # 2) Orden priority
        target = enforce_strict_priority(target)
        target = list(dict.fromkeys(target))

        print(f"[order] PRIORITY aplicada. {len(target)} tablas seleccionadas.")
        print("[order] Orden final:", " -> ".join(target))

        job.total_tables = len(target)
        job.processed_tables = 0
        job.progress = 0.0

        engine = SyncEngine(
            src,
            dst,
            config={"include": ["public.*"], "exclude": ["public.alembic_version"]},
        )

        job.write_log(
            f"Comienza sync {payload.source} → {payload.dest}. "
            f"Tablas={job.total_tables}, execute={payload.execute}, destructive={payload.allow_destructive}"
        )

        # 3) Procesar tabla a tabla
        for idx, full in enumerate(target, start=1):
            if job._cancel:
                job.status = "canceled"
                job.write_log("Cancelado por el usuario.")
                return

            job.current_table = full
            job.write_log(f"→ [{idx}/{job.total_tables}] {full}")

            engine.mirror(
                tables=[full],
                exclude=None,
                execute=payload.execute,
                allow_destructive=payload.allow_destructive,
            )

            job.processed_tables = idx
            job.progress = round((idx / (job.total_tables or 1)) * 100.0, 2)

        job.status = "done"
        job.ended_at = time.time()
        job.current_table = None
        job.write_log("✅ Job finalizado con éxito.")

    except Exception as e:
        job.status = "error"
        job.ended_at = time.time()
        job.error = repr(e)

        job.write_log("❌ ERROR: " + repr(e))

        tb = traceback.format_exc()
        job.write_log("----- TRACEBACK BEGIN -----")
        job.write_log(tb.rstrip())
        job.write_log("----- TRACEBACK END -----")

    finally:
        sys.stdout = old_stdout


# ------------------------------
# Endpoints
# ------------------------------
@router.get("/ping")
def db_ping():
    # Nota: tu "where" histórico decía /api/db/ping. Aquí devolvemos algo neutro.
    return {"ok": True, "where": "/db/ping"}


@router.get("/targets")
def db_targets():
    return {"targets": ["neon", "supabase", "sheets"]}


@router.post("/sync/start")
def start_sync(req: SyncStartRequest):
    job = Job(req)
    with JOBS_LOCK:
        JOBS[job.id] = job
    th = threading.Thread(target=_run_job, args=(job,), daemon=True)
    th.start()
    return {"job_id": job.id, "status": job.status}


@router.get("/sync/{job_id}")
def get_status(job_id: str) -> SyncStatusResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return SyncStatusResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        started_at=job.started_at,
        ended_at=job.ended_at,
        log_tail=job.tail(3000),
        error=job.error,
        current_table=job.current_table,
        total_tables=job.total_tables,
        processed_tables=job.processed_tables,
    )


@router.post("/sync/{job_id}/cancel")
def cancel_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    job._cancel = True
    return {"ok": True, "status": "cancel_requested"}


@router.get("/sheets/check")
def sheets_check():
    """
    Verifica que:
    - Existe GOOGLE_SHEETS_ID
    - Existen credenciales (o se pueden materializar desde GOOGLE_CREDENTIALS_JSON)
    - Podemos acceder al spreadsheet y listar “tables” (worksheets/targets)
    """
    ensure_gcp_creds_file()

    sid = _get_env("GOOGLE_SHEETS_ID")
    creds = _get_env("GOOGLE_APPLICATION_CREDENTIALS")

    if not sid:
        return {"ok": False, "error": "GOOGLE_SHEETS_ID is empty"}
    if not creds:
        return {"ok": False, "error": "GOOGLE_APPLICATION_CREDENTIALS is empty"}

    try:
        a = SheetsAdapter(spreadsheet_id=sid, creds_path=creds)
        tables = a.list_tables()
        return {"ok": True, "spreadsheet_id": sid, "tables_found": len(tables)}
    except Exception as e:
        return {"ok": False, "spreadsheet_id": sid, "error": repr(e)}
