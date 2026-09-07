from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from app.config import DATA_DIR, settings

DATA_DIR.mkdir(parents=True, exist_ok=True)
COVERS_DIR = DATA_DIR / "covers"
COVERS_DIR.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)


def _ensure_sqlite_columns() -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(novels)")).fetchall()
        names = {row[1] for row in rows}
        if names and "cover_path" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN cover_path VARCHAR DEFAULT ''"))
        if names and "cover_prompt" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN cover_prompt VARCHAR DEFAULT ''"))
        if names and "studio_step" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN studio_step VARCHAR DEFAULT 'idea'"))
        if names and "pending_kind" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN pending_kind VARCHAR DEFAULT ''"))
        if names and "pending_json" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN pending_json VARCHAR DEFAULT ''"))
        if names and "power_system" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN power_system VARCHAR DEFAULT ''"))
        if names and "retired_cast_json" not in names:
            conn.execute(text("ALTER TABLE novels ADD COLUMN retired_cast_json VARCHAR DEFAULT '[]'"))

        ch_rows = conn.execute(text("PRAGMA table_info(chapters)")).fetchall()
        ch_names = {row[1] for row in ch_rows}
        if ch_names and "plot_brief" not in ch_names:
            conn.execute(text("ALTER TABLE chapters ADD COLUMN plot_brief VARCHAR DEFAULT ''"))
        if ch_names and "lock_status" not in ch_names:
            conn.execute(text("ALTER TABLE chapters ADD COLUMN lock_status VARCHAR DEFAULT 'in_progress'"))
        conn.commit()


def init_db() -> None:
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _ensure_sqlite_columns()


def get_session():
    with Session(engine) as session:
        yield session
