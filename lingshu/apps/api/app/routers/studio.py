from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.agents.studio import run_studio_turn
from app.agents.workshop import author_lock, kind_for_step, needs_copy_polish, novel_brief, respects_lock
from app.db import get_session
from app.llm.deepseek import DeepSeekError
from app.models import Character, ChatMessage, Event, Item, Location, Novel, Relationship
from app.models.entities import utcnow
from app.schemas import ChatIn, ChatMessageOut
from app.services import novels as novel_svc
from app.services import planning as plan_svc
from app.services.drafts import looks_off_step, parse_draft, readable_reply, stash_pending
from app.services.pipeline import (
    polish_bible_args,
    polish_copy,
    polish_existing_chapter,
    polish_meta_args,
    polish_outline_args,
    polish_saved_target,
    write_and_polish_chapter,
)
from app.services.studio_steps import (
    NEXT_PROMPT,
    WELCOME,
    field_welcome,
    is_confirm,
    normalize_field,
    step_info,
)

router = APIRouter(prefix="/api/novels/{novel_id}", tags=["studio"])


def _looks_like_idea(text: str) -> bool:
    stripped = (text or "").strip()
    if len(stripped) < 80:
        return False
    keys = ("男主", "女主", "穿越", "系统", "故事", "主角", "修炼", "我想写", "蓝星", "龙国")
    return any(key in stripped for key in keys) or len(stripped) >= 200


def _novel(session: Session, novel_id: int):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    return novel


def _messages(session: Session, novel_id: int) -> list[ChatMessage]:
    return list(
        session.exec(
            select(ChatMessage).where(ChatMessage.novel_id == novel_id).order_by(ChatMessage.created_at, ChatMessage.id)
        ).all()
    )


def _ensure_welcome(session: Session, novel_id: int, field: str | None = None) -> None:
    rows = _messages(session, novel_id)
    if rows:
        return
    session.add(ChatMessage(novel_id=novel_id, role="assistant", content=field_welcome(field)))
    session.commit()


def _apply_field_step(session: Session, novel: Novel, field: str | None) -> None:
    """字段 AI 弹窗打开时，把 studio_step 切到对应步骤，保证 STEP_LOCK 与草稿 kind 正确。"""
    step = normalize_field(field)
    if not step:
        return
    if (novel.studio_step or "") == step:
        return
    novel.studio_step = step
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)


def _last_assistant(session: Session, novel_id: int) -> ChatMessage | None:
    rows = [row for row in _messages(session, novel_id) if row.role == "assistant"]
    return rows[-1] if rows else None


def _recover_pending(session: Session, novel: Novel) -> None:
    if (novel.pending_kind or "").strip() and (novel.pending_json or "").strip():
        return
    last = _last_assistant(session, novel.id or 0)
    if not last:
        return
    content = (last.content or "").strip()
    if content == WELCOME or content == field_welcome(novel.studio_step):
        return
    parsed = parse_draft(last.content or "", novel.studio_step or "idea")
    if not parsed:
        return
    if looks_off_step(last.content or "", novel.studio_step or "idea"):
        return
    kind, payload = parsed
    stash_pending(session, novel, kind, payload)


@router.get("/studio")
def studio_state(novel_id: int, session: Session = Depends(get_session)):
    novel = _novel(session, novel_id)
    _ensure_welcome(session, novel_id)
    _recover_pending(session, novel)
    info = step_info(novel.studio_step or "idea")
    return {
        "novel": novel_svc.to_out(session, novel),
        "messages": [
            ChatMessageOut(
                id=row.id or 0,
                novel_id=row.novel_id,
                role=row.role,
                content=row.content,
                created_at=row.created_at,
            )
            for row in _messages(session, novel_id)
        ],
        "characters": session.exec(select(Character).where(Character.novel_id == novel_id)).all(),
        "relationships": session.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all(),
        "locations": session.exec(select(Location).where(Location.novel_id == novel_id)).all(),
        "items": session.exec(select(Item).where(Item.novel_id == novel_id)).all(),
        "events": session.exec(select(Event).where(Event.novel_id == novel_id)).all(),
        "step": info,
    }


@router.post("/chat")
async def studio_chat(novel_id: int, payload: ChatIn, session: Session = Depends(get_session)):
    novel = _novel(session, novel_id)
    field = normalize_field(payload.field)
    _apply_field_step(session, novel, field)
    _ensure_welcome(session, novel_id, field)
    history = [{"role": row.role, "content": row.content} for row in _messages(session, novel_id) if row.role in ("user", "assistant")]
    user_text = payload.content.strip()
    session.add(ChatMessage(novel_id=novel_id, role="user", content=user_text))
    session.commit()

    if is_confirm(user_text):
        kind = (novel.pending_kind or "").strip()
        raw = (novel.pending_json or "").strip()
        if kind and raw:
            try:
                pending_payload = json.loads(raw)
            except json.JSONDecodeError:
                pending_payload = {}
            if not isinstance(pending_payload, dict):
                pending_payload = {"volumes": pending_payload} if kind in ("outline", "chapters") else {}
            result = plan_svc.apply_pending(session, novel, kind, pending_payload)
            session.refresh(novel)
            nxt = NEXT_PROMPT.get(str(result.get("step") or ""), "")
            if nxt:
                user_text = nxt

    step_now = novel.studio_step or "idea"
    if _looks_like_idea(user_text):
        history = [row for row in history if row.get("content") == WELCOME][:1]
        if (not (novel.premise or "").strip() or len(user_text) > len(novel.premise or "")) and step_now in (
            "idea",
            "naming",
        ):
            novel.premise = user_text[:8000]
            novel.updated_at = utcnow()
            session.add(novel)
            session.commit()
            session.refresh(novel)

    saved: list[str] = []
    progress: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def on_progress(event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind in ("token", "done"):
            if kind == "done":
                await progress.put({"type": "stage", "label": "过审完成，正在整理回复…"})
            return
        if kind == "review":
            overall = (event.get("data") or {}).get("overall")
            await progress.put({"type": "stage", "stage": "review", "label": f"审查综合 {overall}，继续处理…"})
            return
        await progress.put(event)

    async def on_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
        from sqlmodel import Session as DBSession

        from app.db import engine

        if name == "write_chapter":
            saved.append("chapter")
            return await write_and_polish_chapter(
                novel_id,
                int(args.get("number") or 1),
                mode=str(args.get("mode") or "plot"),
                instruction=str(args.get("instruction") or ""),
                target_words=int(args.get("target_words") or 3500),
                on_progress=on_progress,
            )
        if name == "repolish_chapter":
            saved.append("chapter")
            return await polish_existing_chapter(
                novel_id,
                int(args.get("number") or 0),
                on_progress=on_progress,
            )
        if name == "repolish_saved":
            target = str(args.get("target") or "meta")
            saved.append(target)
            return await polish_saved_target(novel_id, target, on_progress=on_progress)
        if name == "propose_draft":
            kind = str(args.get("kind") or "")
            draft = args.get("payload") if isinstance(args.get("payload"), dict) else {}
            if kind not in ("meta", "bible", "outline", "chapters", "power"):
                return {"ok": False, "error": "草稿类型不对"}
            with DBSession(engine) as db:
                current = db.get(Novel, novel_id)
                if not current:
                    return {"ok": False, "error": "小说不存在"}
                expected = {
                    "idea": "meta",
                    "naming": "meta",
                    "world": "meta",
                    "power": "power",
                    "bible": "bible",
                    "outline": "outline",
                    "chapters": "chapters",
                }.get(current.studio_step or "idea")
                if expected and kind != expected:
                    return {
                        "ok": False,
                        "error": f"当前是{current.studio_step}，只能 propose_draft(kind={expected})，不要再给书名或大纲。",
                    }
                if kind == "bible" and not (isinstance(draft.get("characters"), list) and draft.get("characters")):
                    return {"ok": False, "error": "角色草稿必须包含 characters 数组，不要传书名简介大纲。"}
                if kind == "power":
                    from app.services.power_system import coerce_power_payload

                    text = coerce_power_payload(draft if isinstance(draft, dict) else {})
                    if not text:
                        return {"ok": False, "error": "修炼体系草稿必须包含 power_system 全文。"}
                    draft = {"power_system": text}
                brief = f"{author_lock(user_text, current.premise or '')}\n{novel_brief(current)}"
                lock_text = user_text or (current.premise or "")
            if kind == "meta":
                draft = await polish_meta_args(draft, brief=brief, on_progress=on_progress)
            elif kind == "bible":
                draft = await polish_bible_args(draft, brief=brief, on_progress=on_progress)
            elif kind in ("outline", "chapters"):
                draft = await polish_outline_args(draft, brief=brief, on_progress=on_progress)
                if kind == "outline":
                    from app.services.outline import parse_outline

                    volumes = parse_outline(draft.get("volumes") if isinstance(draft, dict) else draft)
                    for vol in volumes:
                        vol["chapters"] = []
                    draft = {"volumes": volumes}
            if kind in ("meta", "bible", "outline", "chapters", "power") and not respects_lock(
                lock_text, json.dumps(draft, ensure_ascii=False)
            ):
                return {"ok": False, "error": "草稿和作者想法对不上，请按原话重写后再 propose_draft。"}
            with DBSession(engine) as db:
                current = db.get(Novel, novel_id)
                if not current:
                    return {"ok": False, "error": "小说不存在"}
                if kind == "meta" and (current.studio_step or "idea") == "idea":
                    current.studio_step = "naming"
                current.pending_kind = kind
                current.pending_json = json.dumps(draft, ensure_ascii=False)
                current.updated_at = utcnow()
                db.add(current)
                db.commit()
            saved.append("pending")
            return {"ok": True, "pending": kind, "hint": "已暂存。请作者点确认后再写入左边。"}

        if name in ("save_meta", "save_outline", "save_bible", "set_step"):
            return {
                "ok": False,
                "error": "请先 propose_draft 暂存，等作者点确认后再写入。不要直接 save 或跳步骤。",
            }
        return {"ok": False, "error": f"未知工具 {name}"}

    async def event_stream():
        from sqlmodel import Session as DBSession

        from app.db import engine

        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        async def producer() -> None:
            try:
                from app.services import chapters as chapter_svc

                from sqlmodel import Session as DBSession

                from app.db import engine

                with DBSession(engine) as db:
                    rows = chapter_svc.list_chapters(db, novel_id)
                    chars = db.exec(select(Character).where(Character.novel_id == novel_id)).all()
                brief = (
                    "\n".join(
                        f"第{c.number}章《{c.title}》{c.word_count}字 {c.status}"
                        for c in rows
                    )
                    or "还没有章节正文"
                )
                character_brief = (
                    "\n".join(f"{c.name}（{c.role}）{c.personality}" for c in chars) or "还没有角色"
                )
                reply = await run_studio_turn(
                    novel,
                    history,
                    user_text,
                    on_tool,
                    brief,
                    character_brief,
                    thinking=bool(payload.thinking),
                    on_reasoning=lambda text: progress.put({"type": "reasoning", "text": text}),
                )
                with DBSession(engine) as db:
                    fresh = db.get(Novel, novel_id)
                step = (fresh.studio_step if fresh else novel.studio_step) or "idea"
                reply = readable_reply(reply, step)
                if needs_copy_polish(reply, saved) and not looks_off_step(reply, step):
                    pack_brief = author_lock(user_text, (fresh.premise if fresh else "") or "")
                    if fresh:
                        pack_brief = f"{pack_brief}\n{novel_brief(fresh)}"
                    polished = await polish_copy(
                        reply,
                        kind=kind_for_step(step),
                        brief=pack_brief,
                        on_progress=on_progress,
                    )
                    text = polished.get("content")
                    lock = user_text or ((fresh.premise if fresh else "") or "")
                    if isinstance(text, str) and text.strip() and respects_lock(lock, text):
                        reply = readable_reply(text, step)
                if "pending" not in saved:
                    with DBSession(engine) as db:
                        fresh = db.get(Novel, novel_id)
                        parsed = (
                            parse_draft(reply, (fresh.studio_step if fresh else "idea") or "idea")
                            if fresh
                            else None
                        )
                        if fresh and parsed and not looks_off_step(reply, (fresh.studio_step or "idea")):
                            stash_pending(db, fresh, parsed[0], parsed[1])
                            saved.append("pending")
                await progress.put({"type": "_reply", "text": reply})
            except DeepSeekError as exc:
                await progress.put({"type": "error", "message": str(exc)})
            except Exception as exc:  # noqa: BLE001
                await progress.put({"type": "error", "message": f"对话失败：{exc}"})
            finally:
                await progress.put(None)

        task = asyncio.create_task(producer())
        try:
            yield sse({"type": "stage", "label": "深度思考中…" if payload.thinking else "正在想…"})
            while True:
                event = await progress.get()
                if event is None:
                    break
                if event.get("type") == "_reply":
                    reply = str(event.get("text") or "")
                    if reply:
                        for i in range(0, len(reply), 24):
                            yield sse({"type": "token", "text": reply[i : i + 24]})
                    with DBSession(engine) as db:
                        db.add(ChatMessage(novel_id=novel_id, role="assistant", content=reply))
                        db.commit()
                        fresh = novel_svc.get_novel(db, novel_id)
                        out = novel_svc.to_out(db, fresh) if fresh else None
                    yield sse({"type": "saved", "fields": saved, "novel": out.model_dump(mode="json") if out else None})
                    yield sse({"type": "done", "content": reply})
                    continue
                yield sse(event)
        finally:
            await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/confirm")
def confirm_draft(novel_id: int, session: Session = Depends(get_session)):
    novel = _novel(session, novel_id)
    _recover_pending(session, novel)
    kind = (novel.pending_kind or "").strip()
    raw = (novel.pending_json or "").strip()
    if not kind or not raw:
        raise HTTPException(status_code=400, detail="还没有待确认的草稿。等 AI 出稿后再点确认。")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {"volumes": payload} if kind in ("outline", "chapters") else {}
    result = plan_svc.apply_pending(session, novel, kind, payload)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "确认失败")
    session.refresh(novel)
    next_step = result.get("step") or ""
    return {
        "ok": True,
        "kind": kind,
        "step": next_step,
        "next_prompt": NEXT_PROMPT.get(next_step, ""),
        "novel": novel_svc.to_out(session, novel),
    }


@router.delete("/chat/{message_id}")
def delete_chat_message(
    novel_id: int,
    message_id: int,
    field: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    _novel(session, novel_id)
    row = session.get(ChatMessage, message_id)
    if not row or row.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="消息不存在")
    session.delete(row)
    session.commit()
    _ensure_welcome(session, novel_id, normalize_field(field))
    return {"ok": True}


@router.delete("/chat")
def clear_chat(
    novel_id: int,
    field: str | None = Query(default=None),
    session: Session = Depends(get_session),
):
    novel = _novel(session, novel_id)
    step = normalize_field(field)
    _apply_field_step(session, novel, step)
    for row in _messages(session, novel_id):
        session.delete(row)
    session.commit()
    _ensure_welcome(session, novel_id, step)
    return {"ok": True}
