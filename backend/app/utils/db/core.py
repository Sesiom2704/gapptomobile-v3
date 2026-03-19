"""
/**
 * Ruta: backend/app/utils/db/core.py
 * Versión: 1.0.0
 * Descripción:
 * Motor de sincronización tabla a tabla para GAPPTO Mobile 3.0.
 *
 * Funcionalidades incluidas:
 * - Sincroniza tablas entre adapters Postgres y Google Sheets.
 * - Soporta origen y destino en Neon, Supabase y Sheets a través de adapters.
 * - Lee tablas desde source y las escribe en dest.
 * - Detecta views y matviews en Postgres.
 * - Evita escritura en views/matviews cuando no se permite modo destructivo.
 * - Soporta ejecución real y dry-run.
 * - Normaliza datos al pasar de Sheets a Postgres.
 * - Refleja estructura en destino Postgres cuando el origen también es Postgres.
 * - Delega en los adapters la lógica específica de lectura y escritura.
 *
 * Ajustes de esta versión:
 * - Se elimina una validación redundante de headers al escribir en Google Sheets.
 * - Se reduce una llamada innecesaria por tabla hacia la API de Sheets.
 * - Se mantiene la validación de headers dentro del adapter de Sheets.
 * - Se conserva el comportamiento funcional existente del motor.
 *
 * Notas de diseño:
 * - El objetivo es reducir llamadas repetidas a Google Sheets sin cambiar contratos.
 * - La responsabilidad de asegurar headers en Sheets queda centralizada en el adapter.
 * - La normalización Sheets -> Postgres permanece separada de la lógica de escritura.
 * - Se mantiene un flujo simple y predecible por tabla para no romper compatibilidad.
 */
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.app.utils.db.dbsync.postgres_adapter import PostgresAdapter
from backend.app.utils.db.dbsync.sheets_adapter import SheetsAdapter


class SyncEngine:
    """
    Motor de sincronización “tabla a tabla”.

    Contrato:
      engine.mirror(tables=[...], execute=..., allow_destructive=...)

    Reglas:
      - source y dest pueden ser Postgres o Sheets.
      - Views/MATVIEW:
          - En allow_destructive=False las saltamos para evitar conflictos.
      - Dry-run (execute=False):
          - No escribe.
          - Importante: si el destino es Sheets, NO hacemos lecturas de headers
            (evita exceder cuotas por minuto).
    """

    def __init__(self, source, dest, config: Optional[Dict[str, Any]] = None):
        self.source = source
        self.dest = dest
        self.config = config or {}

    def mirror(
        self,
        *,
        tables: List[str],
        exclude: Optional[List[str]],
        execute: bool,
        allow_destructive: bool,
    ) -> None:
        """
        Ejecuta la sincronización de las tablas indicadas.

        Criterios importantes:
        - Lee siempre desde source.
        - Escribe en dest solo si execute=True.
        - Cuando el destino es Sheets, la validación de headers se deja
          centralizada dentro del adapter para evitar lecturas duplicadas.
        """
        exclude_set = set(exclude or [])

        for full_name in tables:
            if full_name in exclude_set:
                print(f"[mirror] {full_name}: skip (excluded)")
                continue

            # Detectar views/matviews en source Postgres
            if isinstance(self.source, PostgresAdapter):
                info = self.source.table_info(full_name)
                if info.is_view and not allow_destructive:
                    print(
                        f"{full_name} es VIEW/MATVIEW. allow_drop=False → skip para evitar conflictos"
                    )
                    print(
                        f"[mirror] {full_name}: DRY-RUN (no write)"
                        if not execute
                        else f"[mirror] {full_name}: skip view"
                    )
                    print("[mirror] done")
                    continue

            print(f"[mirror] {full_name}: begin")

            # --- Read (desde source) ---
            headers: List[str]
            rows: List[Tuple[Any, ...]]

            if isinstance(self.source, PostgresAdapter):
                headers, rows = self.source.read_table(full_name)

            elif isinstance(self.source, SheetsAdapter):
                headers, rows = self.source.read_table(full_name)

            else:
                raise RuntimeError(f"source adapter no soportado: {type(self.source)}")

            # --- Normalización CRÍTICA Sheets -> Postgres ---
            # Sheets no tiene NULL: los campos vacíos llegan como "" y Postgres no puede
            # castear "" a uuid/int/timestamp/numeric/bool.
            # Además, algunas filas pueden venir más cortas que headers (celdas vacías al final).
            if isinstance(self.source, SheetsAdapter) and isinstance(self.dest, PostgresAdapter):
                hlen = len(headers)

                def _coerce(v: Any) -> Any:
                    if v is None:
                        return None
                    if isinstance(v, str):
                        s = v.strip()
                        if s == "":
                            return None
                        sl = s.lower()

                        # boolean típicos de Sheets
                        if sl in ("true", "false"):
                            return sl == "true"

                        # Dejamos timestamps ISO / números como string;
                        # Postgres suele castear bien.
                        return s

                    return v

                norm_rows: List[Tuple[Any, ...]] = []
                for r in rows:
                    rr = list(r)

                    # Si la fila viene más corta que headers, rellenamos con None
                    if len(rr) < hlen:
                        rr += [None] * (hlen - len(rr))

                    # Si viene más larga, truncamos
                    if len(rr) > hlen:
                        rr = rr[:hlen]

                    norm_rows.append(tuple(_coerce(x) for x in rr))

                rows = norm_rows

            # --- Ensure destination structure ---
            if isinstance(self.dest, PostgresAdapter) and isinstance(self.source, PostgresAdapter):
                # En Postgres->Postgres, reflejamos estructura real
                self.dest.ensure_table_from_source(self.source.engine, full_name)

            if isinstance(self.dest, SheetsAdapter):
                # IMPORTANTE:
                # - En dry-run no tocamos Sheets.
                # - En execute=True no llamamos aquí a ensure_headers, porque write_table()
                #   ya lo hace internamente. Duplicarlo provoca lecturas innecesarias
                #   contra la API de Google Sheets.
                if execute:
                    print(f"[Sheets] {full_name}: write preparation OK")
                else:
                    print(f"[Sheets] {full_name}: (dry-run) skip headers check")

            # --- Write ---
            if isinstance(self.dest, PostgresAdapter):
                # Si el job ya hizo un pre-truncate global, aquí no hay que truncar por tabla.
                clear_first = bool(self.config.get("clear_first_per_table", True))
                self.dest.write_table(
                    full_name,
                    headers,
                    rows,
                    execute=execute,
                    allow_destructive=allow_destructive,
                    clear_first=clear_first,
                )

            elif isinstance(self.dest, SheetsAdapter):
                # En dry-run no escribimos.
                # En execute=True, el propio adapter asegura headers, capacidad y escritura.
                self.dest.write_table(
                    full_name,
                    headers,
                    rows,
                    execute=execute,
                    allow_destructive=allow_destructive,
                )
                if execute:
                    print(f"[Sheets] {full_name}: wrote {len(rows)} rows")

            else:
                raise RuntimeError(f"dest adapter no soportado: {type(self.dest)}")

            if not execute:
                print(f"[mirror] {full_name}: DRY-RUN (no write)")
            else:
                print(f"[mirror] {full_name}: wrote OK")

            print("[mirror] done")