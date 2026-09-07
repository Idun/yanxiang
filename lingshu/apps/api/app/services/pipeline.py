from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from sqlmodel import Session as DBSession, select

from app.agents.planning import CharacterHarvestAgent, ContentPlanAgent, NextChapterAgent, RelationshipSyncAgent
from app.agents.workshop import CoherenceAgent, ContinuityAgent, DeAIAgent, ReaderAgent, ReviewAgent, ReviseAgent, strip_fences
from app.agents.writing import WritingAgent, count_words
from app.db import engine
from app.llm.deepseek import default_model
from app.models import Chapter, GenerationRun
from app.models.entities import utcnow
from app.services import novels as novel_svc
from app.services import planning as plan_svc
from app.services import reviews as review_svc
from app.services.context import ContextAssembler, WritingContext
from app.services.outline import beat_for_chapter

ProgressFn = Callable[[dict[str, Any]], Awaitable[None] | None]

# 两次门（起草后 + 过审后）共享改写次数
CONTINUITY_MAX_RETRIES = 2


class _ReasonBuffer:
    """把流式 reasoning 暂存，穿插在 token 事件前 yield。"""

    def __init__(self) -> None:
        self._chunks: list[str] = []

    async def on_reasoning(self, text: str) -> None:
        if text:
            self._chunks.append(text)

    def drain(self) -> str:
        if not self._chunks:
            return ""
        out = "".join(self._chunks)
        self._chunks.clear()
        return out


async def _ensure_continuity(
    ctx: WritingContext,
    content: str,
    *,
    budget: list[int],
    emit_tokens: bool = True,
    thinking: bool = False,
    out: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    """章间接力硬门：不通过则按 revise_notes 改写，共享 budget 次数。结果写入 out。"""
    current = content
    chapter_number = int(getattr(ctx.chapter, "number", 1) or 1)
    plot_brief = (
        getattr(ctx.chapter, "plot_brief", None) or ctx.instruction or ""
    ).strip()
    scene_plan = (ctx.scene_plan or "").strip()
    reasons = _ReasonBuffer()

    while True:
        yield {"type": "stage", "stage": "continuity", "label": "章间接力校验…"}
        try:
            result = await ContinuityAgent().run(
                current,
                prev_ending=ctx.prev_ending or "",
                plot_brief=plot_brief,
                scene_plan=scene_plan,
                chapter_number=chapter_number,
                thinking=thinking,
            )
        except Exception as exc:  # noqa: BLE001
            result = {
                "pass": True,
                "score": 7,
                "prev_hook": "",
                "opening_ok": True,
                "issues": [f"接力校验跳过（{exc}）"],
                "revise_notes": "",
            }

        if result.get("pass"):
            out["content"] = current
            out["result"] = result
            yield {"type": "continuity", **result}
            return

        left = budget[0] if budget else 0
        if left <= 0:
            out["content"] = current
            out["result"] = result
            yield {"type": "continuity", **result}
            return

        budget[0] = left - 1
        notes = (result.get("revise_notes") or "").strip()
        score = result.get("score")
        yield {
            "type": "stage",
            "stage": "continuity_fix",
            "label": (
                f"章间接力未过（{score}/10），按意见改写…"
                f"（还可改 {budget[0]} 次）"
            ),
        }
        pieces: list[str] = []
        async for token in ReviseAgent().stream(
            current,
            None,
            ctx=ctx,
            author_notes=notes,
            thinking=thinking,
            on_reasoning=reasons.on_reasoning,
        ):
            reason = reasons.drain()
            if reason:
                yield {"type": "reasoning", "text": reason}
            pieces.append(token)
            if emit_tokens:
                yield {"type": "token", "text": token}
        leftover = reasons.drain()
        if leftover:
            yield {"type": "reasoning", "text": leftover}
        rewritten = strip_fences("".join(pieces))
        if rewritten:
            current = rewritten
        # 再校验一轮


async def _emit(on_progress: ProgressFn | None, event: dict[str, Any]) -> None:
    if not on_progress:
        return
    result = on_progress(event)
    if hasattr(result, "__await__"):
        await result  # type: ignore[misc]


async def refresh_next_chapter_after_edit(
    *,
    novel_id: int,
    chapter_id: int,
    chapter_content: str,
    author_notes: str = "",
) -> dict[str, Any] | None:
    """本章正文变更后，按新结尾重算下一章剧情要点并强制写回。"""
    from app.services import chapters as chapter_svc

    with DBSession(engine) as db:
        ch = db.get(Chapter, chapter_id)
        nv = novel_svc.get_novel(db, novel_id)
        if not ch or not nv:
            return None
        existing_next = beat_for_chapter(nv.outline_json, (ch.number or 1) + 1)
        nxt = {c.number: c for c in chapter_svc.list_chapters(db, novel_id)}.get((ch.number or 1) + 1)
        if nxt and (nxt.plot_brief or "").strip():
            existing_next = nxt.plot_brief or existing_next
        meta = {
            "number": ch.number or 1,
            "volume": ch.volume or 1,
            "title": ch.title or "",
            "existing_next": existing_next,
            "novel_title": nv.title,
            "novel_genre": nv.genre,
            "novel_description": nv.description,
            "novel_world": nv.world_bible,
            "novel_power": getattr(nv, "power_system", "") or "",
            "novel_id": nv.id,
        }

    # Novel object may expire after session close; rebuild a light stand-in for the agent
    class _NovelView:
        pass

    view = _NovelView()
    view.title = meta["novel_title"]
    view.genre = meta["novel_genre"]
    view.description = meta["novel_description"]
    view.world_bible = meta["novel_world"]
    view.power_system = meta["novel_power"]

    planned = await NextChapterAgent().run(
        novel=view,  # type: ignore[arg-type]
        chapter_number=int(meta["number"]),
        chapter_title=str(meta["title"]),
        chapter_content=chapter_content,
        author_notes=author_notes,
        existing_next=str(meta["existing_next"] or ""),
    )
    if not (planned.get("title") or planned.get("summary")):
        return None

    with DBSession(engine) as db:
        ch = db.get(Chapter, chapter_id)
        nv = novel_svc.get_novel(db, novel_id)
        if not ch or not nv:
            return None
        saved = plan_svc.upsert_next_chapter_plan(
            db,
            nv,
            current_number=ch.number or 1,
            current_volume=ch.volume or 1,
            title=planned.get("title") or "",
            summary=planned.get("summary") or "",
            force_plot_brief=True,
        )
        if not saved.get("ok"):
            return None
        return {
            "number": saved.get("number"),
            "title": saved.get("title") or "",
            "summary": saved.get("summary") or "",
        }


async def sync_relationships_from_chapter(
    *,
    novel_id: int,
    chapter_content: str,
) -> dict[str, Any]:
    """根据正文自动维护人物关系。"""
    from types import SimpleNamespace

    from app.models import Character, Relationship

    with DBSession(engine) as db:
        nv = novel_svc.get_novel(db, novel_id)
        if not nv:
            return {"ok": False, "updated": 0}
        chars = list(db.exec(select(Character).where(Character.novel_id == novel_id)).all())
        if len(chars) < 1:
            return {"ok": True, "updated": 0, "skipped": "no_characters"}
        id_name = {c.id: c.name for c in chars if c.id}
        old_rows = list(db.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all())
        existing = [
            {
                "from_name": id_name.get(r.from_char_id, ""),
                "to_name": id_name.get(r.to_char_id, ""),
                "relation_type": r.relation_type or "",
                "description": r.description or "",
            }
            for r in old_rows
            if id_name.get(r.from_char_id) and id_name.get(r.to_char_id)
        ]
        novel_view = SimpleNamespace(
            title=nv.title,
            genre=nv.genre,
            description=nv.description,
            world_bible=nv.world_bible,
            power_system=getattr(nv, "power_system", "") or "",
        )
        char_views = [
            SimpleNamespace(
                name=c.name,
                role=c.role or "",
                personality=c.personality or "",
            )
            for c in chars
            if c.name
        ]

    planned = await RelationshipSyncAgent().run(
        novel=novel_view,  # type: ignore[arg-type]
        characters=char_views,
        chapter_content=chapter_content,
        existing_relationships=existing,
    )
    items = planned.get("relationships") or []
    if not items:
        return {"ok": True, "updated": 0, "relationships": []}

    with DBSession(engine) as db:
        updated = plan_svc.upsert_relationships(db, novel_id, items)
    return {"ok": True, "updated": updated, "relationships": items}


async def harvest_characters_from_chapter(
    *,
    novel_id: int,
    chapter_content: str,
) -> dict[str, Any]:
    """把本章新出场的有名角色写入角色表，不覆盖已有核心班底。"""
    from types import SimpleNamespace

    from app.models import Character

    with DBSession(engine) as db:
        nv = novel_svc.get_novel(db, novel_id)
        if not nv:
            return {"ok": False, "created": 0, "names": []}
        chars = list(db.exec(select(Character).where(Character.novel_id == novel_id)).all())
        novel_view = SimpleNamespace(
            title=nv.title,
            genre=nv.genre,
            description=nv.description,
        )
        char_views = [
            SimpleNamespace(name=c.name, role=c.role or "")
            for c in chars
            if c.name
        ]

    planned = await CharacterHarvestAgent().run(
        novel=novel_view,  # type: ignore[arg-type]
        characters=char_views,
        chapter_content=chapter_content,
    )
    items = planned.get("characters") or []
    if not items:
        return {"ok": True, "created": 0, "names": [], "characters": []}

    with DBSession(engine) as db:
        names = plan_svc.upsert_new_characters(db, novel_id, items)
    return {"ok": True, "created": len(names), "names": names, "characters": items}


async def sync_cast_from_chapter(
    *,
    novel_id: int,
    chapter_content: str,
) -> AsyncIterator[dict[str, Any]]:
    """先收录新角色，再维护关系。"""
    try:
        yield {"type": "stage", "stage": "characters", "label": "收录本章新出场角色…"}
        harvested = await harvest_characters_from_chapter(
            novel_id=novel_id, chapter_content=chapter_content
        )
        created = int(harvested.get("created") or 0)
        if created:
            yield {
                "type": "characters",
                "updated": created,
                "names": harvested.get("names") or [],
                "items": harvested.get("characters") or [],
            }
    except Exception:  # noqa: BLE001
        pass
    try:
        yield {"type": "stage", "stage": "relationships", "label": "自动维护人物关系…"}
        rel = await sync_relationships_from_chapter(novel_id=novel_id, chapter_content=chapter_content)
        if rel.get("updated"):
            yield {"type": "relationships", "updated": rel.get("updated"), "items": rel.get("relationships") or []}
    except Exception:  # noqa: BLE001
        pass


async def iter_polish(
    ctx: WritingContext,
    content: str,
    *,
    chapter_id: int,
    novel_id: int,
    apply_revise: bool = True,
    threshold: float = 7.0,
    persist: bool = True,
    emit_tokens: bool = True,
    thinking: bool = False,
    continuity_budget: list[int] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    current = content
    started = time.perf_counter()
    reasons = _ReasonBuffer()
    budget = continuity_budget if continuity_budget is not None else [CONTINUITY_MAX_RETRIES]
    continuity_result: dict[str, Any] | None = None

    yield {
        "type": "stage",
        "stage": "review",
        "label": "深度思考中，审查…" if thinking else "审查 Agent 处理中…",
    }
    review = await ReviewAgent().run(current, ctx=ctx, thinking=thinking)
    if persist:
        with DBSession(engine) as db:
            review_svc.save_review(
                db, chapter_id=chapter_id, novel_id=novel_id, agent="review", payload=review
            )
    yield {"type": "review", "data": review}

    yield {
        "type": "stage",
        "stage": "deai",
        "label": "深度思考中，去 AI 味…" if thinking else "去 AI 味 Agent 改写中…",
    }
    pieces: list[str] = []
    async for token in DeAIAgent().stream(
        current, ctx=ctx, thinking=thinking, on_reasoning=reasons.on_reasoning
    ):
        reason = reasons.drain()
        if reason:
            yield {"type": "reasoning", "text": reason}
        pieces.append(token)
        if emit_tokens:
            yield {"type": "token", "text": token}
    leftover = reasons.drain()
    if leftover:
        yield {"type": "reasoning", "text": leftover}
    rewritten = strip_fences("".join(pieces))
    if rewritten:
        current = rewritten

    if apply_revise and float(review.get("overall") or 0) < threshold:
        yield {
            "type": "stage",
            "stage": "revise",
            "label": "深度思考中，按审查意见改写…" if thinking else "改写 Agent 按审查意见修改…",
        }
        pieces = []
        async for token in ReviseAgent().stream(
            current, review, ctx=ctx, thinking=thinking, on_reasoning=reasons.on_reasoning
        ):
            reason = reasons.drain()
            if reason:
                yield {"type": "reasoning", "text": reason}
            pieces.append(token)
            if emit_tokens:
                yield {"type": "token", "text": token}
        leftover = reasons.drain()
        if leftover:
            yield {"type": "reasoning", "text": leftover}
        rewritten = strip_fences("".join(pieces))
        if rewritten:
            current = rewritten

    yield {
        "type": "stage",
        "stage": "reader",
        "label": "深度思考中，读者评估…" if thinking else "读者 Agent 评估中…",
    }
    reader = await ReaderAgent().run(current, ctx=ctx, thinking=thinking)

    # 过审后接力复检（与起草后共享 budget）
    gate_out: dict[str, Any] = {}
    async for event in _ensure_continuity(
        ctx,
        current,
        budget=budget,
        emit_tokens=emit_tokens,
        thinking=thinking,
        out=gate_out,
    ):
        yield event
    if gate_out.get("content"):
        current = str(gate_out["content"])
    continuity_result = gate_out.get("result") if isinstance(gate_out.get("result"), dict) else None

    summary = ""
    try:
        summary = await WritingAgent().summarize(current)
    except Exception:  # noqa: BLE001
        summary = ""

    wc = count_words(current)
    if persist:
        with DBSession(engine) as db:
            ch = db.get(Chapter, chapter_id)
            nv = novel_svc.get_novel(db, novel_id)
            if ch:
                review_svc.save_content(db, ch, current, "polished")
                if summary:
                    ch.summary = summary
                    db.add(ch)
                review_svc.save_review(
                    db, chapter_id=chapter_id, novel_id=novel_id, agent="reader", payload=reader
                )
                db.add(
                    GenerationRun(
                        chapter_id=chapter_id,
                        novel_id=novel_id,
                        agent="pipeline",
                        model=default_model(),
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        finish_reason="completed",
                        completion_tokens=wc,
                    )
                )
                if nv:
                    nv.updated_at = utcnow()
                    db.add(nv)
                db.commit()

    # 过审改写后同步刷新下一章剧情要点
    try:
        yield {"type": "stage", "stage": "next_chapter", "label": "根据本章结果更新下一章剧情…"}
        saved_next = await refresh_next_chapter_after_edit(
            novel_id=novel_id,
            chapter_id=chapter_id,
            chapter_content=current,
            author_notes="本章已过审润色，请按最新正文结尾重新衔接下一章。",
        )
        if saved_next:
            yield {"type": "next_chapter", **saved_next}
        else:
            yield {
                "type": "stage",
                "stage": "next_chapter",
                "label": "下一章剧情未更新（模型未给出有效标题/要点）",
            }
    except Exception as exc:  # noqa: BLE001
        yield {
            "type": "stage",
            "stage": "next_chapter",
            "label": f"下一章剧情更新失败（{exc}）",
        }

    # 角色收录改到「章节锁定」时再做，避免生成阶段用角色表卡死剧情
    done: dict[str, Any] = {
        "type": "done",
        "content": current,
        "word_count": wc,
        "summary": summary,
        "review": review,
        "reader": reader,
    }
    if continuity_result is not None:
        done["continuity"] = continuity_result
    yield done


async def iter_write_and_polish(
    ctx: WritingContext,
    *,
    chapter_id: int,
    novel_id: int,
    mode: str,
    polish: bool = True,
    apply_revise: bool = True,
    threshold: float = 7.0,
    emit_tokens: bool = True,
    plan: bool = True,
    thinking: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    started = time.perf_counter()
    reasons = _ReasonBuffer()

    if plan and not (ctx.scene_plan or "").strip():
        yield {
            "type": "stage",
            "stage": "content_plan",
            "label": "深度思考中，内容规划…" if thinking else "内容规划 Agent 拆场景并预告下一章…",
        }
        try:
            plan_data = await ContentPlanAgent().run(ctx, thinking=thinking)
            formatted = ""
            next_chapter: dict[str, Any] = {}
            if isinstance(plan_data, dict):
                formatted = str(plan_data.get("formatted") or "").strip()
                raw_next = plan_data.get("next_chapter")
                if isinstance(raw_next, dict):
                    next_chapter = {
                        "title": str(raw_next.get("title") or "").strip(),
                        "summary": str(raw_next.get("summary") or "").strip(),
                    }
            if formatted:
                ctx.scene_plan = formatted
                yield {
                    "type": "plan",
                    "focus": (plan_data or {}).get("focus") if isinstance(plan_data, dict) else "",
                    "scene_count": len((plan_data or {}).get("scenes") or [])
                    if isinstance(plan_data, dict)
                    else 0,
                    "text": formatted,
                }
            else:
                yield {
                    "type": "stage",
                    "stage": "content_plan",
                    "label": "内容规划未产出有效场景表，改为直接写作…",
                }
            if next_chapter.get("title") or next_chapter.get("summary"):
                from app.services import planning as plan_svc

                with DBSession(engine) as db:
                    nv = novel_svc.get_novel(db, novel_id)
                    ch = db.get(Chapter, chapter_id)
                    if nv and ch:
                        saved = plan_svc.upsert_next_chapter_plan(
                            db,
                            nv,
                            current_number=ch.number or 1,
                            current_volume=ch.volume or 1,
                            title=next_chapter.get("title") or "",
                            summary=next_chapter.get("summary") or "",
                            force_plot_brief=True,
                        )
                        if saved.get("ok"):
                            yield {
                                "type": "next_chapter",
                                "number": saved.get("number"),
                                "title": saved.get("title") or "",
                                "summary": saved.get("summary") or "",
                            }
                            # 刷新上下文大纲，写作时也能看见下一章约束
                            ctx.outline = nv.outline_json or ctx.outline
        except Exception as exc:  # noqa: BLE001
            yield {
                "type": "stage",
                "stage": "content_plan",
                "label": f"内容规划跳过（{exc}），继续写作…",
            }

    yield {
        "type": "stage",
        "stage": "writing",
        "label": "深度思考中，写作起草…" if thinking else "写作 Agent 起草中…",
    }
    pieces: list[str] = []
    async for token in WritingAgent().stream(
        ctx, thinking=thinking, on_reasoning=reasons.on_reasoning
    ):
        reason = reasons.drain()
        if reason:
            yield {"type": "reasoning", "text": reason}
        pieces.append(token)
        if emit_tokens:
            yield {"type": "token", "text": token}
    leftover = reasons.drain()
    if leftover:
        yield {"type": "reasoning", "text": leftover}
    draft = "".join(pieces).strip()
    if not draft:
        yield {"type": "error", "message": "写作 Agent 没有产出正文"}
        return

    continuity_budget = [CONTINUITY_MAX_RETRIES]
    gate_out: dict[str, Any] = {}
    async for event in _ensure_continuity(
        ctx,
        draft,
        budget=continuity_budget,
        emit_tokens=emit_tokens,
        thinking=thinking,
        out=gate_out,
    ):
        yield event
    if gate_out.get("content"):
        draft = str(gate_out["content"])
    continuity_after_write = (
        gate_out.get("result") if isinstance(gate_out.get("result"), dict) else None
    )

    wc = count_words(draft)
    with DBSession(engine) as db:
        ch = db.get(Chapter, chapter_id)
        nv = novel_svc.get_novel(db, novel_id)
        if ch and nv:
            ch.content = draft
            ch.word_count = wc
            ch.status = "generated"
            ch.generation_mode = mode
            ch.updated_at = utcnow()
            nv.updated_at = utcnow()
            db.add(ch)
            db.add(nv)
            db.add(
                GenerationRun(
                    chapter_id=chapter_id,
                    novel_id=novel_id,
                    agent="writing",
                    model=default_model(),
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    finish_reason="completed",
                    completion_tokens=wc,
                )
            )
            db.commit()

    # 草稿一落盘就预填下一章主题：过审失败时也能留下第 N+1 章剧情要点
    next_filled = False
    try:
        yield {
            "type": "stage",
            "stage": "next_chapter",
            "label": "根据本章草稿预填下一章剧情…",
        }
        saved_next = await refresh_next_chapter_after_edit(
            novel_id=novel_id,
            chapter_id=chapter_id,
            chapter_content=draft,
            author_notes="本章草稿已写完，请按正文结尾预填下一章标题与剧情要点。",
        )
        if saved_next:
            next_filled = True
            yield {"type": "next_chapter", **saved_next}
    except Exception as exc:  # noqa: BLE001
        yield {
            "type": "stage",
            "stage": "next_chapter",
            "label": f"下一章预填暂未完成（{exc}），稍后过审结束会再试…",
        }

    if not polish:
        summary = ""
        try:
            summary = await WritingAgent().summarize(draft)
        except Exception:  # noqa: BLE001
            summary = ""
        if summary:
            with DBSession(engine) as db:
                ch = db.get(Chapter, chapter_id)
                if ch:
                    ch.summary = summary
                    db.add(ch)
                    db.commit()
        done: dict[str, Any] = {
            "type": "done",
            "content": draft,
            "word_count": wc,
            "summary": summary,
        }
        if continuity_after_write is not None:
            done["continuity"] = continuity_after_write
        yield done
        return

    yield {"type": "stage", "stage": "polish", "label": "草稿已落盘，开始过审…"}
    try:
        async for event in iter_polish(
            ctx,
            draft,
            chapter_id=chapter_id,
            novel_id=novel_id,
            apply_revise=apply_revise,
            threshold=threshold,
            persist=True,
            emit_tokens=emit_tokens,
            thinking=thinking,
            continuity_budget=continuity_budget,
        ):
            if event.get("type") == "next_chapter":
                next_filled = True
            yield event
    except Exception as exc:  # noqa: BLE001
        # 过审失败时正文已保存；若尚未预填下一章则再补一次，避免只剩本章
        if not next_filled:
            try:
                yield {
                    "type": "stage",
                    "stage": "next_chapter",
                    "label": "过审中断，仍根据草稿补写下一章剧情…",
                }
                saved_next = await refresh_next_chapter_after_edit(
                    novel_id=novel_id,
                    chapter_id=chapter_id,
                    chapter_content=draft,
                    author_notes="过审未完成，请仍按本章草稿结尾预填下一章。",
                )
                if saved_next:
                    yield {"type": "next_chapter", **saved_next}
            except Exception:  # noqa: BLE001
                pass
        yield {
            "type": "error",
            "message": f"过审失败：{exc}（本章正文已保存；下一章主题已尽量预填）",
        }
        return


def _tool_result(done: dict[str, Any], *, chapter_id: int, number: int, title: str) -> dict[str, Any]:
    review = done.get("review") or {}
    reader = done.get("reader") or {}
    return {
        "ok": True,
        "chapter_id": chapter_id,
        "number": number,
        "title": title,
        "word_count": done.get("word_count") or 0,
        "review_overall": review.get("overall"),
        "reader_overall": reader.get("overall"),
        "would_continue": reader.get("would_continue"),
        "one_liner": reader.get("one_liner") or "",
        "hint": "正文已写入章节，不要把全文贴进对话。作者可去写章页查看；不满意请再调用 repolish_chapter。",
    }


def _assemble_chapter(db: DBSession, novel_id: int, number: int, *, mode: str, instruction: str, target_words: int):
    from app.schemas import ChapterCreate
    from app.services import chapters as chapter_svc
    from app.services.outline import beat_for_chapter

    novel = novel_svc.get_novel(db, novel_id)
    if not novel:
        return None, None, None, {"ok": False, "error": "小说不存在"}
    chapter = next((c for c in chapter_svc.list_chapters(db, novel_id) if c.number == number), None)
    beat = beat_for_chapter(novel.outline_json, number)
    if not chapter:
        title = beat.split("：", 1)[0] if "：" in beat else (beat[:20] if beat else f"第{number}章")
        chapter = chapter_svc.create_chapter(
            db,
            novel_id,
            ChapterCreate(number=number, title=title or f"第{number}章"),
        )
        if beat and not chapter.summary:
            chapter.summary = beat
            db.add(chapter)
            db.commit()
            db.refresh(chapter)
    instr = (instruction or "").strip() or beat or (chapter.summary or "")
    ctx = ContextAssembler().assemble(
        db,
        novel=novel,
        chapter=chapter,
        mode=mode,
        instruction=instr,
        target_words=target_words,
        character_ids=[],
    )
    return novel, chapter, ctx, None


async def write_and_polish_chapter(
    novel_id: int,
    number: int,
    *,
    mode: str = "plot",
    instruction: str = "",
    target_words: int = 3500,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    if mode not in ("plot", "lottery"):
        mode = "plot"
    target_words = min(max(int(target_words or 3500), 400), 8000)
    number = max(int(number or 1), 1)

    db = DBSession(engine, expire_on_commit=False)
    try:
        _, chapter, ctx, err = _assemble_chapter(
            db, novel_id, number, mode=mode, instruction=instruction, target_words=target_words
        )
        if err:
            return err
        assert chapter is not None and ctx is not None
        chapter_id = chapter.id or 0
        title = chapter.title
    finally:
        db.close()

    try:
        done: dict[str, Any] | None = None
        async for event in iter_write_and_polish(
            ctx,
            chapter_id=chapter_id,
            novel_id=novel_id,
            mode=mode,
            polish=True,
            emit_tokens=False,
        ):
            await _emit(on_progress, event)
            if event.get("type") == "error":
                return {"ok": False, "error": event.get("message") or "写章失败"}
            if event.get("type") == "done":
                done = event
        if not done:
            return {"ok": False, "error": "写章流水线没有完成"}
        return _tool_result(done, chapter_id=chapter_id, number=number, title=title)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def polish_existing_chapter(
    novel_id: int,
    number: int = 0,
    *,
    apply_revise: bool = True,
    threshold: float = 7.0,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    from app.services import chapters as chapter_svc

    db = DBSession(engine, expire_on_commit=False)
    try:
        novel = novel_svc.get_novel(db, novel_id)
        if not novel:
            return {"ok": False, "error": "小说不存在"}
        chapters = chapter_svc.list_chapters(db, novel_id)
        chapter = None
        if number:
            chapter = next((c for c in chapters if c.number == int(number)), None)
        else:
            with_content = [c for c in chapters if (c.content or "").strip()]
            chapter = with_content[-1] if with_content else None
        if not chapter:
            return {"ok": False, "error": "还没有可优化的章节"}
        content = (chapter.content or "").strip()
        if not content:
            return {"ok": False, "error": f"第{chapter.number}章还没有正文"}
        ctx = ContextAssembler().assemble(
            db,
            novel=novel,
            chapter=chapter,
            mode=chapter.generation_mode or "plot",
            instruction="",
            target_words=max(chapter.word_count or 2000, 800),
            character_ids=[],
        )
        chapter_id = chapter.id or 0
        title = chapter.title
        chap_no = chapter.number
    finally:
        db.close()

    try:
        done: dict[str, Any] | None = None
        async for event in iter_polish(
            ctx,
            content,
            chapter_id=chapter_id,
            novel_id=novel_id,
            apply_revise=apply_revise,
            threshold=threshold,
            persist=True,
            emit_tokens=False,
        ):
            await _emit(on_progress, event)
            if event.get("type") == "error":
                return {"ok": False, "error": event.get("message") or "优化失败"}
            if event.get("type") == "done":
                done = event
        if not done:
            return {"ok": False, "error": "优化流水线没有完成"}
        return _tool_result(done, chapter_id=chapter_id, number=chap_no, title=title)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def polish_copy(
    content: str,
    *,
    kind: str = "copy",
    brief: str = "",
    apply_revise: bool = True,
    threshold: float = 7.0,
    as_json: bool = False,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    original = content
    text = (content or "").strip()
    if not text:
        return {"ok": True, "skipped": True, "content": content, "review": {}, "reader": {}}

    current: Any = text
    try:
        await _emit(on_progress, {"type": "stage", "stage": "review", "label": "审查 Agent 处理中…"})
        review = await ReviewAgent().run(text, kind=kind, brief=brief)
        await _emit(on_progress, {"type": "review", "data": review})

        await _emit(on_progress, {"type": "stage", "stage": "deai", "label": "去 AI 味 Agent 改写中…"})
        if as_json:
            rewritten = await DeAIAgent().run_json(text, kind=kind, brief=brief)
            if rewritten:
                current = rewritten
        else:
            pieces: list[str] = []
            async for token in DeAIAgent().stream(text, kind=kind, brief=brief):
                pieces.append(token)
            rewritten_text = strip_fences("".join(pieces))
            if rewritten_text:
                current = rewritten_text

        score = float(review.get("overall") or 0)
        if apply_revise and score < threshold:
            await _emit(on_progress, {"type": "stage", "stage": "revise", "label": "改写 Agent 按审查意见修改…"})
            payload = current if isinstance(current, str) else json.dumps(current, ensure_ascii=False)
            if as_json:
                revised = await DeAIAgent().run_json(
                    payload, kind=kind, brief=brief, review=review, system_name="revise_agent.md"
                )
                if revised:
                    current = revised
            else:
                pieces = []
                async for token in ReviseAgent().stream(payload, review, kind=kind, brief=brief):
                    pieces.append(token)
                rewritten_text = strip_fences("".join(pieces))
                if rewritten_text:
                    current = rewritten_text

        readable = current if isinstance(current, str) else json.dumps(current, ensure_ascii=False)
        await _emit(on_progress, {"type": "stage", "stage": "reader", "label": "读者 Agent 评估中…"})
        reader = await ReaderAgent().run(readable, kind=kind, brief=brief)
        await _emit(
            on_progress,
            {
                "type": "done",
                "content": current if isinstance(current, str) else readable,
                "review": review,
                "reader": reader,
            },
        )
        return {"ok": True, "content": current, "review": review, "reader": reader}
    except Exception:  # noqa: BLE001
        return {"ok": False, "content": original, "review": {}, "reader": {}, "skipped": True}


def _as_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            data = json.loads(value)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
    return None


async def polish_meta_args(args: dict[str, Any], *, brief: str, on_progress: ProgressFn | None = None) -> dict[str, Any]:
    pack = {
        "title": args.get("title") or "",
        "genre": args.get("genre") or "",
        "description": args.get("description") or "",
        "cover_prompt": args.get("cover_prompt") or "",
        "world_bible": args.get("world_bible") or "",
        "power_system": args.get("power_system") or "",
    }
    if not any(str(v).strip() for v in pack.values()):
        return args
    if (pack.get("power_system") or "").strip() and not (pack.get("description") or "").strip() and not (pack.get("world_bible") or "").strip():
        kind = "power"
    elif (pack["world_bible"] or "").strip() and not (pack["description"] or "").strip():
        kind = "world"
    else:
        kind = "title"
    result = await polish_copy(
        json.dumps(pack, ensure_ascii=False),
        kind=kind,
        brief=brief,
        as_json=True,
        on_progress=on_progress,
    )
    polished = _as_dict(result.get("content"))
    if not polished:
        return args
    out = dict(args)
    for key in pack:
        value = polished.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value.strip()
    return out


async def polish_outline_args(args: dict[str, Any], *, brief: str, on_progress: ProgressFn | None = None) -> dict[str, Any]:
    payload = args.get("volumes") or args.get("outline") or args
    result = await polish_copy(
        json.dumps(payload, ensure_ascii=False),
        kind="outline",
        brief=brief,
        as_json=True,
        on_progress=on_progress,
    )
    polished = result.get("content")
    data = _as_dict(polished) if not isinstance(polished, list) else {"volumes": polished}
    if isinstance(polished, list):
        return {"volumes": polished}
    if not data:
        return args
    if "volumes" in data or "outline" in data:
        return data
    return args


async def polish_bible_args(args: dict[str, Any], *, brief: str, on_progress: ProgressFn | None = None) -> dict[str, Any]:
    result = await polish_copy(
        json.dumps(args, ensure_ascii=False),
        kind="bible",
        brief=brief,
        as_json=True,
        on_progress=on_progress,
    )
    data = _as_dict(result.get("content"))
    return data or args


async def polish_saved_target(
    novel_id: int,
    target: str,
    *,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    from sqlmodel import select

    from app.agents.workshop import novel_brief
    from app.models import Character, Event, Item, Location, Relationship
    from app.services import planning as plan_svc
    from app.services.outline import dumps_outline, parse_outline

    db = DBSession(engine, expire_on_commit=False)
    try:
        novel = novel_svc.get_novel(db, novel_id)
        if not novel:
            return {"ok": False, "error": "小说不存在"}
        brief = novel_brief(novel)
        meta_pack = {
            "title": novel.title,
            "genre": novel.genre,
            "description": novel.description,
            "premise": novel.premise,
            "cover_prompt": novel.cover_prompt,
            "world_bible": novel.world_bible,
            "power_system": getattr(novel, "power_system", "") or "",
        }
        volumes = parse_outline(novel.outline_json)
        bible_payload = None
        if target == "bible":
            chars = list(db.exec(select(Character).where(Character.novel_id == novel_id)).all())
            rels = list(db.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all())
            locs = list(db.exec(select(Location).where(Location.novel_id == novel_id)).all())
            items = list(db.exec(select(Item).where(Item.novel_id == novel_id)).all())
            events = list(db.exec(select(Event).where(Event.novel_id == novel_id)).all())
            name_of = {c.id: c.name for c in chars}
            bible_payload = {
                "characters": [
                    {
                        "name": c.name,
                        "role": c.role,
                        "personality": c.personality,
                        "background": c.background,
                        "abilities": c.abilities,
                        "status_text": c.status_text,
                        "appearance_notes": c.appearance_notes,
                    }
                    for c in chars
                ],
                "relationships": [
                    {
                        "from_name": name_of.get(r.from_char_id, ""),
                        "to_name": name_of.get(r.to_char_id, ""),
                        "relation_type": r.relation_type,
                        "description": r.description,
                    }
                    for r in rels
                ],
                "locations": [{"name": x.name, "description": x.description, "notes": x.notes} for x in locs],
                "items": [
                    {"name": x.name, "description": x.description, "owner": x.owner, "status_text": x.status_text}
                    for x in items
                ],
                "events": [
                    {
                        "name": x.name,
                        "description": x.description,
                        "timeline": x.timeline,
                        "related_chapters": x.related_chapters,
                    }
                    for x in events
                ],
            }
    finally:
        db.close()

    try:
        if target == "meta":
            args = await polish_meta_args(meta_pack, brief=brief, on_progress=on_progress)
            with DBSession(engine) as write:
                row = novel_svc.get_novel(write, novel_id)
                if not row:
                    return {"ok": False, "error": "小说不存在"}
                for key in ("title", "genre", "description", "premise", "cover_prompt", "world_bible", "power_system"):
                    value = args.get(key)
                    if isinstance(value, str) and value.strip():
                        setattr(row, key, value.strip())
                row.updated_at = utcnow()
                write.add(row)
                write.commit()
            return {"ok": True, "saved": "meta", "hint": "书名简介/世界观已再优化并写回左边。"}
        if target == "outline":
            if not volumes:
                return {"ok": False, "error": "左边还没有大纲"}
            polished = await polish_outline_args({"volumes": volumes}, brief=brief, on_progress=on_progress)
            volumes = parse_outline(polished)
            with DBSession(engine) as write:
                row = novel_svc.get_novel(write, novel_id)
                if not row:
                    return {"ok": False, "error": "小说不存在"}
                row.outline_json = dumps_outline(volumes)
                row.updated_at = utcnow()
                write.add(row)
                write.commit()
                plan_svc.sync_chapters(write, novel_id, volumes)
            return {"ok": True, "saved": "outline", "volumes": len(volumes), "hint": "大纲已再优化并写回左边。"}
        if target == "bible":
            if not bible_payload or not bible_payload.get("characters"):
                return {"ok": False, "error": "左边还没有设定"}
            polished = await polish_bible_args(bible_payload, brief=brief, on_progress=on_progress)
            with DBSession(engine) as write:
                counts = plan_svc.apply_bible(write, novel_id, polished)
            return {"ok": True, "saved": "bible", "created": counts, "hint": "设定已再优化并写回左边。"}
        if target == "power":
            current = (getattr(novel, "power_system", None) or "").strip()
            if not current:
                return {"ok": False, "error": "左边还没有修炼体系"}
            result = await polish_copy(current, kind="power", brief=brief, as_json=False, on_progress=on_progress)
            text = str(result.get("content") or "").strip()
            if not text:
                return {"ok": False, "error": "优化后没有得到修炼体系"}
            from app.services.power_system import normalize_power_system

            text = normalize_power_system(text)
            with DBSession(engine) as write:
                row = novel_svc.get_novel(write, novel_id)
                if not row:
                    return {"ok": False, "error": "小说不存在"}
                row.power_system = text
                row.updated_at = utcnow()
                write.add(row)
                write.commit()
            return {"ok": True, "saved": "power", "hint": "修炼体系已再优化并写回。"}
        return {"ok": False, "error": f"未知目标 {target}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


_POWER_BY_CHAPTER = {
    1: "林舟对外伪装凝气中期，实际更深但不暴露；禁止写成星芒境。",
    2: "林舟对外仍是凝气中期伪装。",
    3: "林舟对外凝气中期伪装；赵铁山等对手按已出场修为，不要突然越级。",
    4: "林舟对外凝气中期伪装。",
    5: "林舟凝气巅峰（可对内感知，对外仍可压着打）。",
    6: "林舟凝气巅峰。",
    7: "林舟触及化罡门槛，尚未稳在化罡。",
    8: "林舟仍在化罡门槛附近，不要写成通神或星芒。",
    9: "林舟化罡门槛到化罡前期之间，按原文战果，不要跳级。",
    10: "林舟接近或刚入化罡前期。",
    11: "林舟化罡前期。星芒印记不是星芒境。",
    12: "林舟化罡中期。星芒印记不是星芒境。",
    13: "林舟化罡中期。",
    14: "林舟化罡中期。缓章，不要开大战升级。",
}

_CHAPTER_FIX = {
    1: "必须重写套话句，禁止几乎原样贴回。「微微」全章最多1次。删掉经脉猛兽、幼兽出林。「全球大比」最多远处一句传闻。",
    2: "「全球大比」不要写成正戏预告。压缩套话。",
    3: "删掉合上拍子、幼兽类比喻。套话合计不超过2次。",
    11: "压缩「微微/一抹」。深渊之主战力按化罡前期，不要跳到星芒境。",
    12: "后半必须改：周衡接应回基地，不要发全国大比令牌、不要定龙都竞技场为正戏。大比最多一句传闻。特使姓名是周衡。林舟化罡中期，星芒印记不是境界。",
    13: "删掉问全国大比场地、龙都竞技场下月十二、去大比揭真相。回程伏击和徽章保留。钩子是龙都波频，下一站是回家不是赛场。",
    14: "母亲必须叫沈清。缓章回家后感知龙都波频，不去赛场。不要再写全国大比。",
}


def _coherence_user(
    *,
    chapter_number: int,
    title: str,
    plot_brief: str,
    prev_ending: str,
    content: str,
    cast_lines: str,
    power_note: str,
) -> str:
    expand = ""
    compact = "".join((content or "").split())
    if len(compact) < 2200:
        expand = "本章原文过短或被截断，必须补写完整，目标约 3000 字，不要只改开头。"
    extra = _CHAPTER_FIX.get(int(chapter_number) or 0, "")
    chap_power = _POWER_BY_CHAPTER.get(int(chapter_number) or 0, "")
    if extra:
        expand = (expand + "\n" + extra).strip()
    if chap_power:
        power_note = f"{power_note}\n本章：{chap_power}"
    return f"""第{chapter_number}章《{title}》

【本章剧情要点｜必须落地，超前全国大比正戏要改掉】
{plot_brief or "（无）"}

【战力锁定】
{power_note}

【已出场人物｜姓名身份修为必须连贯，禁止改名】
{cast_lines or "男主林舟。父林国栋，母沈清。"}

【上一章结尾｜开场必须接】
{prev_ending or "（开篇或无）"}

{expand}

【待梳理正文】
{content}
"""


async def iter_coherence_book(
    novel_id: int,
    *,
    start_number: int = 1,
    end_number: int = 14,
    thinking: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """按章梳理已写正文：文风克制、人物/战力连贯。不删锁，只改内容。"""
    start_number = max(int(start_number or 1), 1)
    end_number = max(int(end_number or start_number), start_number)
    agent = CoherenceAgent()
    writer = WritingAgent()

    with DBSession(engine) as db:
        novel = novel_svc.get_novel(db, novel_id)
        if not novel:
            yield {"type": "error", "message": "小说不存在"}
            return
        from app.models import Character

        chars = list(db.exec(select(Character).where(Character.novel_id == novel_id)).all())
        cast_lines = "\n".join(
            f"- {c.name}｜{c.role or '未标'}｜{c.status_text or ''}｜{c.abilities or ''}"
            for c in chars
            if (c.name or "").strip()
        )
        power_note = (
            "本卷常用：淬体、开脉、凝气、化罡、通神。"
            "林舟：1-4章对外凝气中期伪装；5-6章凝气巅峰；7章触及化罡门槛；"
            "11章化罡前期；12章后化罡中期。星芒印记不是星芒境。"
            "母亲沈清，父亲林国栋。全国大比不要写成正在开赛。"
        )
        rows = list(
            db.exec(
                select(Chapter)
                .where(Chapter.novel_id == novel_id)
                .order_by(Chapter.number.asc())
            ).all()
        )
        targets = [
            {
                "id": c.id,
                "number": c.number or 0,
                "title": c.title or "",
                "plot_brief": c.plot_brief or c.summary or "",
                "content": c.content or "",
                "lock": getattr(c, "lock_status", None) or "in_progress",
            }
            for c in rows
            if start_number <= int(c.number or 0) <= end_number and (c.content or "").strip()
        ]

    if not targets:
        yield {"type": "error", "message": "选定范围内没有已写正文"}
        return

    prev_ending = ""
    with DBSession(engine) as db:
        before = db.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id, Chapter.number < start_number)
            .order_by(Chapter.number.desc())
        ).first()
        if before and (before.content or "").strip():
            from app.services.context import ending_excerpt

            prev_ending = ending_excerpt(before.content)

    for item in targets:
        num = item["number"]
        yield {
            "type": "stage",
            "stage": "coherence",
            "label": f"正在梳理第{num}章《{item['title']}》…",
            "number": num,
        }
        user = _coherence_user(
            chapter_number=num,
            title=item["title"],
            plot_brief=item["plot_brief"],
            prev_ending=prev_ending,
            content=item["content"],
            cast_lines=cast_lines,
            power_note=power_note,
        )
        pieces: list[str] = []
        async for token in agent.stream(item["content"], user=user, thinking=thinking):
            pieces.append(token)
            yield {"type": "token", "text": token, "number": num}
        text = strip_fences("".join(pieces)).strip()
        if text.startswith(f"第{num}章") or text.startswith("第"):
            # 去掉误带的章名行
            first, _, rest = text.partition("\n")
            if "章" in first[:12] and len(rest) > 80:
                text = rest.strip()
        if len("".join(text.split())) < 400:
            yield {
                "type": "error",
                "message": f"第{num}章梳理失败：模型几乎没写出正文",
                "number": num,
            }
            continue
        summary = ""
        try:
            summary = await writer.summarize(text)
        except Exception:  # noqa: BLE001
            summary = ""
        wc = count_words(text)
        with DBSession(engine) as db:
            ch = db.get(Chapter, item["id"])
            if ch:
                review_svc.save_content(db, ch, text, "polished", bypass_lock=True)
                if summary:
                    ch.summary = summary
                    db.add(ch)
                    db.commit()
                ch.lock_status = item["lock"]
                db.add(ch)
                db.commit()
        from app.services.context import ending_excerpt

        prev_ending = ending_excerpt(text)
        yield {
            "type": "chapter_done",
            "number": num,
            "title": item["title"],
            "word_count": wc,
            "content": text,
            "summary": summary,
        }

    yield {"type": "done", "start_number": start_number, "end_number": end_number}
