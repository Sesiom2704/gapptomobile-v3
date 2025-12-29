# backend/app/api/v1/db_router.py
from __future__ import annotations

import io
import os
import sys
import time
import uuid
import threading
import traceback
from typing import Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.utils.db.core import SyncEngine
from backend.app.utils.db.dbsync.postgres_adapter import PostgresAdapter
from backend.app.utils.db.dbsync.sheets_adapter import SheetsAdapter


# ------------------------------
# PRIORITY (preferencia / desempate)
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
]
PRIORITY_INDEX = {t: i for i, t in enumerate(PRIORITY)}


# ------------------------------
# Router (RUTA FINAL: /api/db/...)
# main.py debe incluir este router con prefix="/api"
# ------------------------------
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
# Helpers env/adapters
# ------------------------------
def _get_env(name: str) -> str:
    v = os.getenv(name, "")
    return v.strip().strip('"').strip("'")


def make_adapter(name: str):
    name = (name or "").lower()

    if name == "neon":
        url = _get_env("DB_URL_NEON")
        if not url:
            raise HTTPException(status_code=500, detail="DB_URL_NEON no está configurada")
        return PostgresAdapter(url)

    if name == "supabase":
        url = _get_env("DB_URL_SUPABASE")
        if not url:
            raise HTTPException(status_code=500, detail="DB_URL_SUPABASE no está configurada")
        return PostgresAdapter(url)

    if name == "sheets":
        sid = _get_env("GOOGLE_SHEETS_ID")
        creds = _get_env("GOOGLE_APPLICATION_CREDENTIALS")
        if not sid:
            raise HTTPException(status_code=500, detail="GOOGLE_SHEETS_ID no está configurada")
        if not creds:
            raise HTTPException(status_code=500, detail="GOOGLE_APPLICATION_CREDENTIALS no está configurada")
        return SheetsAdapter(spreadsheet_id=sid, creds_path=creds)

    raise HTTPException(status_code=400, detail=f"Adapter desconocido: {name}")


def _normalize_requested_tables(all_tables: List[str], requested: Optional[List[str]]) -> List[str]:
    """
    Convierte payload.tables a full_names existentes.
    Acepta:
      - "public.users"
      - "users"  (se busca en all_tables)
    """
    if not requested:
        return list(all_tables)

    wanted = set([t.strip() for t in requested if t and t.strip()])
    out: List[str] = []
    for t in all_tables:
        short = t.split(".", 1)[-1]
        if t in wanted or short in wanted:
            out.append(t)
    return out


def _normalize_exclude(exclude: Optional[List[str]]) -> Set[str]:
    """
    Normaliza exclude aceptando "public.x" o "x".
    Devuelve set con ambos formatos posibles para comparación flexible.
    """
    ex = set()
    for e in (exclude or []):
        if not e:
            continue
        e2 = e.strip()
        if not e2:
            continue
        ex.add(e2)
        # si viene "public.x", añadimos "x"
        if "." in e2:
            ex.add(e2.split(".", 1)[-1])
        else:
            # si viene "x", añadimos "public.x" como comodín típico
            ex.add(f"public.{e2}")
    return ex


# ------------------------------
# Blindaje: expandir dependencias FK + topological sort
# ------------------------------
def _expand_with_fk_dependencies(
    *,
    src: PostgresAdapter,
    initial_tables: List[str],
    public_only: bool = True,
) -> Tuple[List[str], List[str]]:
    """
    Devuelve:
      (expanded_tables, added_tables)

    - initial_tables: tablas objetivo (full_names)
    - expanded_tables: incluye dependencias transitivas (padres) por FKs
    """
    initial_set = set(initial_tables)

    edges = src.list_fk_edges(schema="public" if public_only else "")
    parents_by_child: Dict[str, Set[str]] = {}
    for child, parent in edges:
        parents_by_child.setdefault(child, set()).add(parent)

    expanded: Set[str] = set(initial_set)
    added: Set[str] = set()

    # BFS/DFS: por cada tabla, incluir sus parents, y los parents de esos parents, etc.
    stack = list(initial_set)
    while stack:
        t = stack.pop()
        for p in parents_by_child.get(t, set()):
            if p not in expanded:
                expanded.add(p)
                added.add(p)
                stack.append(p)

    # Mantener orden determinista (PRIORITY primero si aplica)
    def sort_key(x: str):
        return (PRIORITY_INDEX.get(x, 10_000), x)

    expanded_list = sorted(expanded, key=sort_key)
    added_list = sorted(added, key=sort_key)
    return expanded_list, added_list


def _toposort_with_priority(
    *,
    nodes: List[str],
    edges_child_parent: List[Tuple[str, str]],
) -> List[str]:
    """
    Ordena nodes de forma que:
      parent -> child (padres antes que hijos)

    edges_child_parent viene como (child, parent), lo convertimos internamente a parent->child.

    Desempate:
      - PRIORITY primero
      - luego alfabético
    """
    node_set = set(nodes)

    # Build adjacency parent -> children, and indegree
    children: Dict[str, Set[str]] = {n: set() for n in node_set}
    indeg: Dict[str, int] = {n: 0 for n in node_set}

    for child, parent in edges_child_parent:
        if child not in node_set or parent not in node_set:
            continue
        # parent -> child
        if child not in children[parent]:
            children[parent].add(child)
            indeg[child] += 1

    def pick_key(x: str):
        return (PRIORITY_INDEX.get(x, 10_000), x)

    # Ready = indegree 0
    ready = sorted([n for n in node_set if indeg[n] == 0], key=pick_key)
    out: List[str] = []

    while ready:
        n = ready.pop(0)
        out.append(n)
        for ch in sorted(children.get(n, set()), key=pick_key):
            indeg[ch] -= 1
            if indeg[ch] == 0:
                # insert in order keeping ready sorted by pick_key
                ready.append(ch)
                ready.sort(key=pick_key)

    # Si hay ciclo (raro), hacemos fallback: PRIORITY + alpha,
    # y dejamos visible que hubo ciclo.
    if len(out) != len(node_set):
        remaining = [n for n in nodes if n not in set(out)]
        remaining_sorted = sorted(set(remaining), key=pick_key)
        return out + remaining_sorted

    return out


def _build_final_plan(
    *,
    src,
    all_tables: List[str],
    requested_tables: Optional[List[str]],
    exclude: Optional[List[str]],
) -> Tuple[List[str], List[str]]:
    """
    Devuelve:
      (final_target_tables, info_lines)

    - Si src es PostgresAdapter:
        - normaliza requested
        - filtra public.*
        - aplica exclude (pero NO bloquea dependencias; auto-incluir manda)
        - expande dependencias FK
        - toposort por FKs con PRIORITY tie-break
    - Si src NO es PostgresAdapter:
        - fallback: PRIORITY primero + resto estable
    """
    info: List[str] = []

    # 1) Candidate base
    base = _normalize_requested_tables(all_tables, requested_tables)
    base = [t for t in base if t.startswith("public.")]
    info.append(f"[plan] Tablas base seleccionadas: {len(base)}")

    ex = _normalize_exclude(exclude)

    # 2) Apply exclude a base (solo para lo “pedido”)
    base_excluded = [t for t in base if (t not in ex and t.split(".", 1)[-1] not in ex)]
    if len(base_excluded) != len(base):
        info.append(f"[plan] Exclude aplicado sobre base: {len(base) - len(base_excluded)} removidas")
    base = base_excluded

    # 3) Blindaje FK si source es Postgres
    if isinstance(src, PostgresAdapter):
        expanded, added = _expand_with_fk_dependencies(src=src, initial_tables=base, public_only=True)
        if added:
            info.append(f"[plan] Dependencias FK auto-incluidas: {len(added)}")
            info.append("[plan] Added: " + " -> ".join(added))

        # Re-aplicar exclude SOLO si el usuario insiste:
        # Pero tú pediste “auto incluir” para blindar. Así que:
        # - si una tabla requerida está en exclude, la mantenemos y lo avisamos.
        forced = [t for t in expanded if (t in ex or t.split(".", 1)[-1] in ex)]
        if forced:
            info.append(
                f"[plan] AVISO: {len(forced)} tablas estaban en exclude pero se fuerzan por dependencias FK."
            )

        edges = src.list_fk_edges(schema="public")
        ordered = _toposort_with_priority(nodes=expanded, edges_child_parent=edges)

        info.append(f"[plan] Orden final (FK): {len(ordered)}")
        return ordered, info

    # 4) Fallback (Sheets como source, etc.)
    def pr_key(x: str):
        return (PRIORITY_INDEX.get(x, 10_000), x)

    ordered = sorted(set(base), key=pr_key)
    info.append(f"[plan] Orden final (fallback PRIORITY): {len(ordered)}")
    return ordered, info


# ------------------------------
# Runner del job
# ------------------------------
def _run_job(job: Job):
    job.status = "running"
    job.started_at = time.time()
    payload = job.payload

    old_stdout = sys.stdout
    sys.stdout = job.log_buf

    try:
        if payload.source == payload.dest:
            raise RuntimeError("source y dest no pueden ser iguales")

        src = make_adapter(payload.source)
        dst = make_adapter(payload.dest)

        # 1) Tablas candidatas desde source (puede incluir views/matviews)
        all_tables = src.list_tables()

        # 2) Plan blindado (auto deps + topo sort)
        target, plan_info = _build_final_plan(
            src=src,
            all_tables=all_tables,
            requested_tables=payload.tables,
            exclude=payload.exclude,
        )

        # Logs del plan (muy útiles para depurar FKs)
        print(f"[order] Selección inicial (plan): {len(target)} tablas.")
        for line in plan_info:
            print(line)
        print("[order] Orden plan:", " -> ".join(target))

        # 2.b) Filtrar views/matviews si vamos a ESCRIBIR a Postgres o truncar
        # - Pre-truncate: solo tablas reales en destino
        # - Mirror: solo tablas (no views/matviews) si src es Postgres
        target_write = list(target)

        if isinstance(src, PostgresAdapter):
            filtered = []
            skipped_views = []
            for t in target:
                try:
                    info = src.table_info(t)
                    if info.is_view:
                        skipped_views.append(t)
                        continue
                except Exception:
                    # Si no podemos saberlo, mejor no arriesgar en escrituras a Postgres
                    # pero lo dejamos pasar (source puede ser Sheets)
                    pass
                filtered.append(t)
            target_write = filtered
            if skipped_views:
                print(f"[order] Skip views/matviews en mirror: {len(skipped_views)}")
                print("[order] Views skipped:", " -> ".join(skipped_views))

        # Para truncar: SOLO tablas reales existentes en destino (si destino es Postgres)
        target_truncate = []
        if isinstance(dst, PostgresAdapter):
            real_dest = set(dst.list_real_tables(schema="public"))
            target_truncate = [t for t in target_write if t in real_dest]

        # Ajustar totales y progreso en base a lo que realmente se va a procesar
        job.total_tables = len(target_write)
        job.processed_tables = 0
        job.progress = 0.0

        engine = SyncEngine(
            src,
            dst,
            config={
                "include": ["public.*"],
                "exclude": ["public.alembic_version"],
                # Tras pre-truncate global, no truncar en cada tabla:
                "clear_first_per_table": False,
            },
        )

        job.write_log(
            f"Comienza sync {payload.source} → {payload.dest}. "
            f"Tablas(plan)={len(target)}, Tablas(write)={job.total_tables}, "
            f"execute={payload.execute}, destructive={payload.allow_destructive}"
        )

        # --- PRE-CLEAR DEST (Postgres): truncar todas las TABLAS a la vez ---
        # Esto evita: "cannot truncate a table referenced in a foreign key constraint"
        # y evita intentar truncar vistas (vw_financiaciones, etc.)
        if payload.execute and isinstance(dst, PostgresAdapter):
            job.write_log(
                f"[pre] Truncating destination REAL tables: {len(target_truncate)} (single statement) ..."
            )
            dst.truncate_tables(target_truncate, allow_destructive=payload.allow_destructive)
            job.write_log("[pre] Destination truncated OK.")

        # 3) Ejecutar tabla a tabla (solo write list)
        for idx, full in enumerate(target_write, start=1):
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

            # Si el destino es Sheets y estás ejecutando, micro pausa para repartir cuota
            if payload.dest == "sheets" and payload.execute:
                time.sleep(0.4)

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
    return {"ok": True, "where": "/api/db/ping"}


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
    Chequeo rápido para confirmar:
      - GOOGLE_SHEETS_ID
      - GOOGLE_APPLICATION_CREDENTIALS
      - acceso real al spreadsheet
      - número de worksheets encontradas
    """
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
