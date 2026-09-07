from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.agents.workshop import DeAIAgent, ReaderAgent, ReviewAgent, ReviseAgent, revise_needs_retry, strip_fences
from app.agents.writing import WritingAgent, count_words
from app.db import get_session
from app.llm.deepseek import DeepSeekError, default_model
from app.models import Chapter, GenerationRun
from app.models.entities import utcnow
from app.schemas import CoherenceIn, NovelReportOut, PipelineIn, ReviewOut, ReviseIn
from app.services import novels as novel_svc
from app.services import reviews as review_svc
from app.services.context import ContextAssembler

router = APIRouter(tags=["workshop"])


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


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _ctx_for(session: Session, chapter: Chapter):
    novel = _novel_or_404(session, chapter.novel_id)
    return novel, ContextAssembler().assemble(
        session,
        novel=novel,
        chapter=chapter,
        mode=chapter.generation_mode or "plot",
        instruction="",
        target_words=max(chapter.word_count or 2000, 800),
        character_ids=[],
    )


def _require_content(chapter: Chapter) -> str:
    if not (chapter.content or "").strip():
        raise HTTPException(status_code=400, detail="本章还没有正文，请先生成或粘贴内容。")
    return chapter.content


def _ensure_unlocked(chapter: Chapter) -> None:
    if (getattr(chapter, "lock_status", None) or "in_progress") == "locked":
        raise HTTPException(status_code=400, detail="章节已锁定，请先解锁再改写")


def _stream_headers():
    return {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


def _log_run(session: Session, chapter: Chapter, agent: str, duration_ms: int, tokens: int = 0) -> None:
    session.add(
        GenerationRun(
            chapter_id=chapter.id,
            novel_id=chapter.novel_id,
            agent=agent,
            model=default_model(),
            duration_ms=duration_ms,
            finish_reason="completed",
            completion_tokens=tokens,
        )
    )
    session.commit()


@router.get("/api/chapters/{chapter_id}/reviews", response_model=list[ReviewOut])
def get_reviews(chapter_id: int, session: Session = Depends(get_session)):
    _chapter_or_404(session, chapter_id)
    return [review_svc.to_out(row) for row in review_svc.list_reviews(session, chapter_id)]


@router.post("/api/chapters/{chapter_id}/review", response_model=ReviewOut)
async def run_review(chapter_id: int, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    _ensure_unlocked(chapter)
    content = _require_content(chapter)
    _, ctx = _ctx_for(session, chapter)
    started = time.perf_counter()
    try:
        result = await ReviewAgent().run(content, ctx=ctx)
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"审查失败：{exc}") from exc
    row = review_svc.save_review(
        session, chapter_id=chapter.id or 0, novel_id=chapter.novel_id, agent="review", payload=result
    )
    chapter.status = "reviewed"
    chapter.updated_at = utcnow()
    session.add(chapter)
    _log_run(session, chapter, "review", int((time.perf_counter() - started) * 1000))
    return review_svc.to_out(row)


@router.post("/api/chapters/{chapter_id}/reader", response_model=ReviewOut)
async def run_reader(chapter_id: int, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    content = _require_content(chapter)
    _, ctx = _ctx_for(session, chapter)
    started = time.perf_counter()
    try:
        result = await ReaderAgent().run(content, ctx=ctx)
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"读者评估失败：{exc}") from exc
    row = review_svc.save_review(
        session, chapter_id=chapter.id or 0, novel_id=chapter.novel_id, agent="reader", payload=result
    )
    _log_run(session, chapter, "reader", int((time.perf_counter() - started) * 1000))
    return review_svc.to_out(row)


@router.get("/api/novels/{novel_id}/report", response_model=NovelReportOut)
def novel_report(novel_id: int, session: Session = Depends(get_session)):
    _novel_or_404(session, novel_id)
    return review_svc.novel_report(session, novel_id)


@router.post("/api/chapters/{chapter_id}/deai")
async def run_deai(chapter_id: int, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    _ensure_unlocked(chapter)
    content = _require_content(chapter)
    _, ctx = _ctx_for(session, chapter)
    return StreamingResponse(
        _rewrite_stream(chapter.id or 0, ctx, content, "deai"),
        media_type="text/event-stream",
        headers=_stream_headers(),
    )


@router.post("/api/chapters/{chapter_id}/revise")
async def run_revise(
    chapter_id: int,
    payload: ReviseIn = ReviseIn(),
    session: Session = Depends(get_session),
):
    chapter = _chapter_or_404(session, chapter_id)
    _ensure_unlocked(chapter)
    notes = (payload.notes or "").strip()
    editor_text = (payload.content or "").strip()
    content = editor_text or _require_content(chapter)
    if not content.strip():
        raise HTTPException(status_code=400, detail="本章还没有正文，请先生成或粘贴内容。")
    latest = None if notes else review_svc.latest_by_agent(session, chapter_id, "review")
    if not notes and not latest:
        raise HTTPException(
            status_code=400,
            detail="请先填写优化点，或先运行审查后再改写。",
        )
    _, ctx = _ctx_for(session, chapter)
    review = None
    if latest:
        review = {
            "scores": json.loads(latest.scores_json or "{}"),
            "overall": latest.overall,
            "issues": json.loads(latest.issues_json or "[]"),
            "suggestions": json.loads(latest.suggestions_json or "[]"),
        }
    return StreamingResponse(
        _rewrite_stream(
            chapter.id or 0,
            ctx,
            content,
            "revise",
            review,
            notes,
            thinking=bool(payload.thinking),
        ),
        media_type="text/event-stream",
        headers=_stream_headers(),
    )


@router.post("/api/novels/{novel_id}/coherence")
async def run_coherence(novel_id: int, payload: CoherenceIn, session: Session = Depends(get_session)):
    """梳理已写章节：克制文风、战力/人物连贯。可覆盖锁定章（锁状态保持）。"""
    _novel_or_404(session, novel_id)
    start = min(payload.start_number, payload.end_number)
    end = max(payload.start_number, payload.end_number)

    async def event_stream():
        from app.services.pipeline import iter_coherence_book

        try:
            async for event in iter_coherence_book(
                novel_id,
                start_number=start,
                end_number=end,
                thinking=bool(payload.thinking),
            ):
                yield _sse(event)
        except DeepSeekError as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"梳理失败：{exc}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=_stream_headers(),
    )


@router.post("/api/chapters/{chapter_id}/pipeline")
async def run_pipeline(chapter_id: int, payload: PipelineIn, session: Session = Depends(get_session)):
    chapter = _chapter_or_404(session, chapter_id)
    _ensure_unlocked(chapter)
    content = _require_content(chapter)
    _, ctx = _ctx_for(session, chapter)
    chapter_id_val = chapter.id or 0
    novel_id_val = chapter.novel_id

    async def event_stream():
        from app.services.pipeline import iter_polish

        try:
            async for event in iter_polish(
                ctx,
                content,
                chapter_id=chapter_id_val,
                novel_id=novel_id_val,
                apply_revise=payload.apply_revise,
                threshold=payload.threshold,
                thinking=bool(payload.thinking),
            ):
                yield _sse(event)
        except DeepSeekError as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"流水线失败：{exc}"})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_stream_headers())


async def _rewrite_stream(
    chapter_id: int,
    ctx,
    content: str,
    agent: str,
    review: dict | None = None,
    author_notes: str = "",
    thinking: bool = False,
):
    from sqlmodel import Session as DBSession

    from app.db import engine

    started = time.perf_counter()
    pieces: list[str] = []
    pending_reason: list[str] = []

    async def on_reasoning(text: str) -> None:
        if text:
            pending_reason.append(text)

    async def drain_reason():
        if not pending_reason:
            return
        chunk = "".join(pending_reason)
        pending_reason.clear()
        return chunk

    try:
        label = "深度思考中，按优化点改写…" if thinking and agent == "revise" else "按优化点改写中…"
        yield _sse({"type": "stage", "stage": "revise", "label": label})
        stream = (
            ReviseAgent().stream(
                content,
                review,
                ctx=ctx,
                author_notes=author_notes,
                thinking=thinking,
                on_reasoning=on_reasoning,
            )
            if agent == "revise"
            else DeAIAgent().stream(content, ctx=ctx)
        )
        async for token in stream:
            reason = await drain_reason()
            if reason:
                yield _sse({"type": "reasoning", "text": reason})
            pieces.append(token)
            yield _sse({"type": "token", "text": token})
        leftover = await drain_reason()
        if leftover:
            yield _sse({"type": "reasoning", "text": leftover})
        text = strip_fences("".join(pieces))

        if agent == "revise" and revise_needs_retry(author_notes, content, text):
            yield _sse(
                {
                    "type": "stage",
                    "stage": "revise",
                    "label": "上一稿没按你的要求改到位，正在重写…",
                }
            )
            pieces = []
            stronger = (
                (author_notes or "").strip()
                + "\n\n上一稿没有落实我的要求。请重新按我的话改写已有正文，只输出完整正文。"
            )
            async for token in ReviseAgent().stream(
                content,
                review,
                ctx=ctx,
                author_notes=stronger,
                thinking=thinking,
                on_reasoning=on_reasoning,
            ):
                reason = await drain_reason()
                if reason:
                    yield _sse({"type": "reasoning", "text": reason})
                pieces.append(token)
                yield _sse({"type": "token", "text": token})
            leftover = await drain_reason()
            if leftover:
                yield _sse({"type": "reasoning", "text": leftover})
            text = strip_fences("".join(pieces))

        summary = ""
        try:
            summary = await WritingAgent().summarize(text)
        except Exception:  # noqa: BLE001
            summary = ""
        wc = count_words(text)
        next_no = 2
        with DBSession(engine) as db:
            ch = db.get(Chapter, chapter_id)
            if ch:
                next_no = (ch.number or 1) + 1
                review_svc.save_content(db, ch, text, "polished")
                if summary:
                    ch.summary = summary
                    db.add(ch)
                    db.commit()
                _log_run(db, ch, agent, int((time.perf_counter() - started) * 1000), wc)

        # 优化后按新正文重写下一章（如第二章）主要内容/剧情要点
        try:
            yield _sse(
                {
                    "type": "stage",
                    "stage": "next_chapter",
                    "label": f"正在更新第{next_no}章主要内容…",
                }
            )
            from app.services.pipeline import refresh_next_chapter_after_edit

            saved_next = await refresh_next_chapter_after_edit(
                novel_id=ctx.novel.id or 0,
                chapter_id=chapter_id,
                chapter_content=text,
                author_notes=author_notes if agent == "revise" else "正文已润色，请按新结尾衔接下一章。",
            )
            if saved_next:
                yield _sse({"type": "next_chapter", **saved_next})
            else:
                yield _sse(
                    {
                        "type": "stage",
                        "stage": "next_chapter",
                        "label": f"第{next_no}章主要内容未能自动更新，可打开该章后手动改剧情要点。",
                    }
                )
        except Exception as exc:  # noqa: BLE001
            yield _sse(
                {
                    "type": "stage",
                    "stage": "next_chapter",
                    "label": f"下一章主要内容更新失败：{exc}",
                }
            )

        # 角色收录改到章节锁定时，避免改写阶段用角色表限制剧情
        yield _sse({"type": "done", "content": text, "word_count": wc, "summary": summary})
    except DeepSeekError as exc:
        yield _sse({"type": "error", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": f"改写失败：{exc}"})
