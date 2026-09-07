from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.models import Chapter, Review
from app.models.entities import utcnow
from app.schemas import ReviewOut
from app.services.context import word_count


def to_out(row: Review) -> ReviewOut:
    return ReviewOut(
        id=row.id or 0,
        chapter_id=row.chapter_id,
        novel_id=row.novel_id,
        agent=row.agent,
        overall=row.overall,
        scores=json.loads(row.scores_json or "{}"),
        issues=json.loads(row.issues_json or "[]"),
        suggestions=json.loads(row.suggestions_json or "[]"),
        comment=row.comment,
        created_at=row.created_at,
    )


def save_review(
    session: Session,
    *,
    chapter_id: int,
    novel_id: int,
    agent: str,
    payload: dict[str, Any],
) -> Review:
    comment = payload.get("one_liner") or payload.get("comment") or ""
    if payload.get("would_continue") is not None:
        flag = "会点下一章" if payload.get("would_continue") else "可能弃章"
        extra = "；".join(payload.get("complaints") or [])
        comment = f"{flag}。{payload.get('one_liner') or ''} {extra}".strip()
    row = Review(
        chapter_id=chapter_id,
        novel_id=novel_id,
        agent=agent,
        overall=float(payload.get("overall") or 0),
        scores_json=json.dumps(payload.get("scores") or {}, ensure_ascii=False),
        issues_json=json.dumps(payload.get("issues") or payload.get("complaints") or [], ensure_ascii=False),
        suggestions_json=json.dumps(payload.get("suggestions") or payload.get("praise") or [], ensure_ascii=False),
        comment=comment,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_reviews(session: Session, chapter_id: int) -> list[Review]:
    return session.exec(
        select(Review).where(Review.chapter_id == chapter_id).order_by(Review.created_at.desc())
    ).all()


def latest_by_agent(session: Session, chapter_id: int, agent: str) -> Review | None:
    return session.exec(
        select(Review)
        .where(Review.chapter_id == chapter_id, Review.agent == agent)
        .order_by(Review.created_at.desc())
    ).first()


def save_content(session: Session, chapter: Chapter, content: str, status: str, *, bypass_lock: bool = False) -> Chapter:
    if not bypass_lock and (getattr(chapter, "lock_status", None) or "in_progress") == "locked":
        raise ValueError("章节已锁定，无法覆盖正文")
    chapter.content = content
    chapter.word_count = word_count(content)
    chapter.status = status
    chapter.updated_at = utcnow()
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter


def novel_report(session: Session, novel_id: int) -> dict[str, Any]:
    from app.models import Chapter as ChapterModel

    chapters = session.exec(
        select(ChapterModel).where(ChapterModel.novel_id == novel_id).order_by(ChapterModel.number)
    ).all()
    keys = ["consistency", "character", "pacing", "hook", "dialogue", "ai_flavor"]
    buckets: dict[str, list[float]] = {k: [] for k in keys}
    items = []
    reviewed = 0
    for ch in chapters:
        row = latest_by_agent(session, ch.id or 0, "review")
        scores = json.loads(row.scores_json) if row else {}
        if row:
            reviewed += 1
            for k in keys:
                if k in scores:
                    buckets[k].append(float(scores[k]))
        items.append(
            {
                "id": ch.id,
                "number": ch.number,
                "title": ch.title,
                "word_count": ch.word_count,
                "status": ch.status,
                "overall": row.overall if row else None,
                "scores": scores,
            }
        )
    averages = {k: round(sum(v) / len(v), 1) if v else 0 for k, v in buckets.items()}
    return {
        "chapter_count": len(chapters),
        "reviewed_count": reviewed,
        "averages": averages,
        "chapters": items,
    }
