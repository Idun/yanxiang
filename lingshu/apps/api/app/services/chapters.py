from sqlmodel import Session, select

from app.models import Chapter
from app.models.entities import utcnow
from app.schemas import ChapterCreate, ChapterUpdate
from app.services.context import word_count


def list_chapters(session: Session, novel_id: int) -> list[Chapter]:
    return session.exec(
        select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.volume, Chapter.number)
    ).all()


def next_number(session: Session, novel_id: int) -> int:
    chapters = list_chapters(session, novel_id)
    return (max((c.number for c in chapters), default=0) + 1)


def create_chapter(session: Session, novel_id: int, payload: ChapterCreate) -> Chapter:
    number = payload.number or next_number(session, novel_id)
    chapter = Chapter(
        novel_id=novel_id,
        volume=payload.volume,
        number=number,
        title=payload.title or f"第{number}章",
        content=payload.content,
        plot_brief=getattr(payload, "plot_brief", "") or "",
        word_count=word_count(payload.content),
        status="draft",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter


def update_chapter(session: Session, chapter: Chapter, payload: ChapterUpdate) -> Chapter:
    data = payload.model_dump(exclude_unset=True)
    lock = (getattr(chapter, "lock_status", None) or "in_progress").strip()
    new_lock = data.get("lock_status")
    if isinstance(new_lock, str):
        new_lock = new_lock.strip()
        if new_lock not in ("in_progress", "locked"):
            raise ValueError("lock_status 只能是 in_progress 或 locked")
        data["lock_status"] = new_lock

    # 锁定后禁止改正文/标题/剧情要点，只允许解锁
    content_keys = {"title", "content", "summary", "plot_brief", "volume", "number"}
    if lock == "locked" and new_lock != "in_progress":
        touching = content_keys & set(data.keys())
        if touching:
            raise ValueError("章节已锁定，请先解锁再修改")

    for key, value in data.items():
        setattr(chapter, key, value)
    if "content" in data:
        chapter.word_count = word_count(chapter.content)
    chapter.updated_at = utcnow()
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    # 标题或剧情要点变更时同步进大纲
    if "title" in data or ("plot_brief" in data and (chapter.plot_brief or "").strip()):
        from app.services import novels as novel_svc
        from app.services.planning import upsert_outline_chapter_summary

        novel = novel_svc.get_novel(session, chapter.novel_id)
        if novel:
            upsert_outline_chapter_summary(
                session,
                novel,
                number=chapter.number,
                title=chapter.title,
                summary=(chapter.plot_brief or "").strip() or (chapter.summary or ""),
                volume=chapter.volume,
            )
    return chapter


def delete_chapter(session: Session, chapter: Chapter) -> None:
    session.delete(chapter)
    session.commit()
