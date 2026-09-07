from pathlib import Path
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.agents.writing import BootstrapAgent
from app.db import COVERS_DIR, get_session
from app.llm.deepseek import DeepSeekError
from app.models.entities import utcnow
from app.schemas import BootstrapIn, NovelCreate, NovelOut, NovelUpdate
from app.services import novels as novel_svc
from app.services.pipeline import polish_copy, polish_outline_args

router = APIRouter(prefix="/api/novels", tags=["novels"])


@router.get("", response_model=list[NovelOut])
def list_novels(session: Session = Depends(get_session)):
    return novel_svc.list_novels(session)


@router.post("", response_model=NovelOut)
def create_novel(payload: NovelCreate, session: Session = Depends(get_session)):
    novel = novel_svc.create_novel(session, payload)
    return novel_svc.to_out(session, novel)


@router.post("/bootstrap", response_model=NovelOut)
async def bootstrap_novel(payload: BootstrapIn, session: Session = Depends(get_session)):
    try:
        filled = await BootstrapAgent().run(payload.premise)
        meta = await polish_copy(
            json.dumps(
                {
                    "title": filled["title"],
                    "genre": filled["genre"],
                    "description": filled["description"],
                    "world_bible": filled["world_bible"],
                },
                ensure_ascii=False,
            ),
            kind="title",
            brief=payload.premise,
            as_json=True,
        )
        polished_meta = meta.get("content") if isinstance(meta.get("content"), dict) else {}
        if isinstance(polished_meta, dict):
            for key in ("title", "genre", "description", "world_bible"):
                value = polished_meta.get(key)
                if isinstance(value, str) and value.strip():
                    filled[key] = value.strip()
        try:
            outline = json.loads(filled.get("outline_json") or "[]")
        except json.JSONDecodeError:
            outline = []
        if outline:
            polished_outline = await polish_outline_args({"outline": outline}, brief=payload.premise)
            volumes = polished_outline.get("volumes") or polished_outline.get("outline") or outline
            filled["outline_json"] = json.dumps(volumes, ensure_ascii=False)
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"立项失败：{exc}") from exc
    novel = novel_svc.create_novel(
        session,
        NovelCreate(
            title=filled["title"],
            description=filled["description"],
            genre=filled["genre"],
            premise=filled["premise"],
            world_bible=filled["world_bible"],
            outline_json=filled["outline_json"],
        ),
    )
    return novel_svc.to_out(session, novel)


@router.get("/{novel_id}", response_model=NovelOut)
def get_novel(novel_id: int, session: Session = Depends(get_session)):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    return novel_svc.to_out(session, novel)


@router.patch("/{novel_id}", response_model=NovelOut)
def update_novel(novel_id: int, payload: NovelUpdate, session: Session = Depends(get_session)):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    novel = novel_svc.update_novel(session, novel, payload)
    return novel_svc.to_out(session, novel)


@router.delete("/{novel_id}")
def delete_novel(novel_id: int, session: Session = Depends(get_session)):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    novel_svc.delete_novel(session, novel)
    return {"ok": True}


ALLOWED_COVER = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


@router.post("/{novel_id}/cover", response_model=NovelOut)
async def upload_cover(novel_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    suffix = Path(file.filename or "cover.jpg").suffix.lower()
    if suffix not in ALLOWED_COVER:
        raise HTTPException(status_code=400, detail="封面只支持 jpg / png / webp")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="封面不能超过 5MB")
    dest = COVERS_DIR / f"{novel_id}{suffix}"
    for old in COVERS_DIR.glob(f"{novel_id}.*"):
        if old != dest and old.is_file():
            old.unlink()
    dest.write_bytes(data)
    novel.cover_path = str(dest)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel_svc.to_out(session, novel)


@router.get("/{novel_id}/cover")
def get_cover(novel_id: int, session: Session = Depends(get_session)):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel or not (novel.cover_path or "").strip():
        raise HTTPException(status_code=404, detail="还没有封面")
    path = Path(novel.cover_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="封面文件丢失")
    media = ALLOWED_COVER.get(path.suffix.lower(), "image/jpeg")
    return FileResponse(path, media_type=media)
