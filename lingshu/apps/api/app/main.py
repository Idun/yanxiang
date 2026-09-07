from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import load_settings
from app.db import init_db
from app.routers import bible, chapters, novels, planning, settings, studio, workshop


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="NOVA 灵枢", version="0.4.0", lifespan=lifespan)

cfg = load_settings()
origins = [o.strip() for o in cfg.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(novels.router)
app.include_router(studio.router)
app.include_router(planning.router)
app.include_router(chapters.router)
app.include_router(bible.router)
app.include_router(settings.router)
app.include_router(workshop.router)


@app.get("/api/health")
def health():
    return {"ok": True, "name": "NOVA", "name_zh": "灵枢"}
