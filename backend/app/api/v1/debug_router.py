from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from backend.app.db.session import get_db

router = APIRouter(prefix="/api/debug", tags=["debug"])

@router.get("/db-smoke")
def db_smoke(db: Session = Depends(get_db)):
    sp = db.execute(text("SHOW search_path")).scalar()
    db_name = db.execute(text("select current_database()")).scalar()
    db_user = db.execute(text("select current_user")).scalar()

    tables = db.execute(text("""
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
        limit 50
    """)).scalars().all()

    gastos = db.execute(text("select count(*) from public.gastos")).scalar()
    ingresos = db.execute(text("select count(*) from public.ingresos")).scalar()

    return {
        "db_name": db_name,
        "db_user": db_user,
        "search_path": sp,
        "tables_count": len(tables),
        "tables_sample": tables[:10],
        "count_gastos": gastos,
        "count_ingresos": ingresos,
    }
