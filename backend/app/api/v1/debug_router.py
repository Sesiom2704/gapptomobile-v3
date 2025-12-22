#backend\app\api\v1\debug_router.py

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from backend.app.db.session import get_db

router = APIRouter(prefix="/api/debug", tags=["debug"])

@router.get("/db-smoke")
def db_smoke(db: Session = Depends(get_db)):
    # 1) confirma search_path efectivo
    sp = db.execute(text("SHOW search_path")).scalar()

    # 2) comprueba que ves tablas (public)
    tables = db.execute(text("""
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
        limit 50
    """)).scalars().all()

    # 3) cuenta filas de 2 tablas clave
    # Ajusta si tu tabla se llama distinto
    gastos = db.execute(text("select count(*) from public.gastos")).scalar()
    ingresos = db.execute(text("select count(*) from public.ingresos")).scalar()

    return {
        "search_path": sp,
        "tables_count": len(tables),
        "tables_sample": tables[:10],
        "count_gastos": gastos,
        "count_ingresos": ingresos,
    }
