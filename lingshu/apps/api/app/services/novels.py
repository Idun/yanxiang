from pathlib import Path

from sqlmodel import Session, func, select

from app.db import COVERS_DIR
from app.models import Chapter, ChatMessage, GenerationRun, Novel, Review
from app.models.entities import utcnow
from app.schemas import NovelCreate, NovelOut, NovelUpdate
from app.services.studio_steps import CONFIRM_LABEL, WELCOME, step_info


def _stats(session: Session, novel_id: int) -> tuple[int, int]:
    chapter_count = session.exec(select(func.count(Chapter.id)).where(Chapter.novel_id == novel_id)).one()
    word_sum = session.exec(select(func.coalesce(func.sum(Chapter.word_count), 0)).where(Chapter.novel_id == novel_id)).one()
    return int(chapter_count or 0), int(word_sum or 0)


def to_out(session: Session, novel: Novel) -> NovelOut:
    chapter_count, word_sum = _stats(session, novel.id)  # type: ignore[arg-type]
    info = step_info(novel.studio_step or "idea")
    if not getattr(novel, "studio_step", None):
        novel.studio_step = "idea"
    if getattr(novel, "cover_prompt", None) is None:
        novel.cover_prompt = ""
    if getattr(novel, "power_system", None) is None:
        novel.power_system = ""
    pending_kind = getattr(novel, "pending_kind", "") or ""
    has_pending = bool(pending_kind and (getattr(novel, "pending_json", "") or "").strip())
    data = NovelOut.model_validate(novel)
    return data.model_copy(
        update={
            "chapter_count": chapter_count,
            "word_count": word_sum,
            "has_cover": bool((novel.cover_path or "").strip()),
            "cover_path": novel.cover_path or "",
            "cover_prompt": getattr(novel, "cover_prompt", "") or "",
            "studio_step": getattr(novel, "studio_step", "idea") or "idea",
            "pending_kind": pending_kind,
            "has_pending": has_pending,
            "confirm_label": CONFIRM_LABEL.get(pending_kind, "确认，写入左边") if has_pending else "",
            "step_label": info["label"],
            "step_hint": info["hint"],
            "next_hint": info["next"],
        }
    )


def list_novels(session: Session) -> list[NovelOut]:
    novels = session.exec(select(Novel).order_by(Novel.updated_at.desc())).all()
    return [to_out(session, n) for n in novels]


def get_novel(session: Session, novel_id: int) -> Novel | None:
    return session.get(Novel, novel_id)


def create_novel(session: Session, payload: NovelCreate) -> Novel:
    novel = Novel(**payload.model_dump())
    if not novel.studio_step:
        novel.studio_step = "idea"
    session.add(novel)
    session.commit()
    session.refresh(novel)
    session.add(
        ChatMessage(
            novel_id=novel.id or 0,
            role="assistant",
            content=WELCOME,
        )
    )
    session.commit()
    return novel


def update_novel(session: Session, novel: Novel, payload: NovelUpdate) -> Novel:
    data = payload.model_dump(exclude_unset=True)
    if "power_system" in data and isinstance(data["power_system"], str):
        from app.services.power_system import normalize_power_system

        data["power_system"] = normalize_power_system(data["power_system"])
    for key, value in data.items():
        setattr(novel, key, value)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return novel


def delete_novel(session: Session, novel: Novel) -> None:
    chapters = session.exec(select(Chapter).where(Chapter.novel_id == novel.id)).all()
    for ch in chapters:
        session.delete(ch)
    from app.models import Character, ChatMessage, Event, Item, Location, Relationship, Storyline

    for model in (ChatMessage, Review, GenerationRun, Relationship, Character, Item, Location, Event, Storyline):
        rows = session.exec(select(model).where(model.novel_id == novel.id)).all()
        for row in rows:
            session.delete(row)
    if novel.cover_path:
        path = Path(novel.cover_path)
        if not path.is_absolute():
            path = COVERS_DIR / path.name
        if path.exists():
            path.unlink()
    session.delete(novel)
    session.commit()
