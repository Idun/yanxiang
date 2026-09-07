import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.db import get_session
from app.llm.deepseek import DeepSeekError
from app.models import Chapter
from app.models.entities import utcnow
from app.schemas import ChapterCreate, ChapterOut, ChapterUpdate, GenerateIn
from app.services import chapters as chapter_svc
from app.services import novels as novel_svc
from app.services.context import ContextAssembler
from app.services.pipeline import iter_write_and_polish

router = APIRouter(tags=["chapters"])


def _novel_or_404(session: Session, novel_id: int):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    return novel


def _chapter_or_404(session: Session, chapter_id: int) -> Chapter:
    chapter = session.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return chapter


@router.get("/api/novels/{novel_id}/chapters", response_model=list[ChapterOut])
def list_chapters(novel_id: int, session: Session = Depends(get_session)):
    _novel_or_404(session, novel_id)
    return chapter_svc.list_chapters(session, novel_id)


@router.post("/api/novels/{novel_id}/chapters", response_model=ChapterOut)
def create_chapter(novel_id: int, payload: ChapterCreate, session: Session = Depends(get_session)):
    novel = _novel_or_404(session, novel_id)
    chapter = chapter_svc.create_chapter(session, novel_id, payload)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    return chapter


@router.patch("/api/chapters/{chapter_id}", response_model=ChapterOut)
def update_chapter(chapter_id: int, payload: ChapterUpdate, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    try:
        return chapter_svc.update_chapter(session, chapter, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    if (getattr(chapter, "lock_status", None) or "") == "locked":
        raise HTTPException(status_code=400, detail="章节已锁定，请先解锁再删除")
    chapter_svc.delete_chapter(session, chapter)
    return {"ok": True}


@router.post("/api/chapters/{chapter_id}/recognize-cast")
async def recognize_cast(chapter_id: int, session: Session = Depends(get_session)):
    """章节锁定后：从正文识别新角色并写入角色表，再同步关系。"""
    from app.services.pipeline import sync_cast_from_chapter

    chapter = _chapter_or_404(session, chapter_id)
    if (getattr(chapter, "lock_status", None) or "in_progress") != "locked":
        raise HTTPException(status_code=400, detail="请先锁定本章，再识别角色")
    body = (chapter.content or "").strip()
    if len(body) < 80:
        raise HTTPException(status_code=400, detail="本章正文太短，无法识别角色")
    novel_id = chapter.novel_id
    created_names: list[str] = []
    rel_updated = 0
    try:
        async for event in sync_cast_from_chapter(novel_id=novel_id, chapter_content=body):
            if event.get("type") == "characters":
                created_names = list(event.get("names") or [])
            if event.get("type") == "relationships":
                rel_updated = int(event.get("updated") or 0)
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"角色识别失败：{exc}") from exc
    return {
        "ok": True,
        "created": len(created_names),
        "names": created_names,
        "relationships_updated": rel_updated,
    }


def _ensure_unlocked(chapter: Chapter) -> None:
    if (getattr(chapter, "lock_status", None) or "in_progress") == "locked":
        raise HTTPException(status_code=400, detail="章节已锁定，请先解锁再生成或改写")


@router.post("/api/chapters/{chapter_id}/generate")
async def generate_chapter(chapter_id: int, payload: GenerateIn, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    _ensure_unlocked(chapter)
    novel = _novel_or_404(session, chapter.novel_id)
    ctx = ContextAssembler().assemble(
        session,
        novel=novel,
        chapter=chapter,
        mode=payload.mode,
        instruction=payload.instruction,
        target_words=payload.target_words,
        character_ids=payload.character_ids,
    )
    chapter_id_val = chapter.id or 0
    novel_id_val = novel.id or 0

    async def event_stream():
        try:
            async for event in iter_write_and_polish(
                ctx,
                chapter_id=chapter_id_val,
                novel_id=novel_id_val,
                mode=payload.mode,
                polish=payload.polish,
                apply_revise=payload.apply_revise,
                threshold=payload.threshold,
                plan=payload.plan,
                thinking=bool(payload.thinking),
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except DeepSeekError as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': f'生成失败：{exc}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
