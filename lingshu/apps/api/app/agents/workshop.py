from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.llm.deepseek import chat_json, chat_stream
from app.services.context import ContextAssembler, WritingContext, power_system_block

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"

KIND_LABELS = {
    "chapter": "章节正文",
    "title": "书名、类型、简介或封面提示词",
    "world": "世界观",
    "power": "修炼/战力体系",
    "outline": "分卷分章大纲",
    "bible": "角色、关系、场景与伏笔",
    "copy": "网文相关文案",
}

KIND_HINTS = {
    "chapter": "按连载章节来审和改。",
    "title": "看点击欲、记忆点、是否像目录卖点，不要写成工作汇报。",
    "world": "要能指导后面写章，规则清楚，少空话。",
    "power": "等级从低到高写清，对决与升级必须能对照，不要前后打架。",
    "outline": "章名短、有钩子；每章摘要能当写作指令；前三章要快。",
    "bible": "人设口吻要能写进对话，伏笔要能兑现。",
    "copy": "像给人看的网文文案，不要套话。",
}


def _prompt(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8").strip()


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def novel_brief(novel: Any) -> str:
    from app.services.outline import format_volumes, parse_outline

    outline = parse_outline(getattr(novel, "outline_json", None))
    outline_text = format_volumes(outline) if outline else "未写"
    return f"""书名：{getattr(novel, 'title', '') or '未定'}
类型：{getattr(novel, 'genre', '') or '未定'}
灵感：{getattr(novel, 'premise', '') or '未写'}
简介：{getattr(novel, 'description', '') or '未写'}
封面提示词：{getattr(novel, 'cover_prompt', '') or '未写'}
世界观：
{getattr(novel, 'world_bible', '') or '（未填）'}
{power_system_block(novel)}
大纲：
{outline_text}
"""


def author_lock(user_text: str = "", premise: str = "") -> str:
    lock = (user_text or "").strip() or (premise or "").strip()
    if not lock:
        return ""
    return f"""【作者原话锁定｜禁止改主角性别、世界、类型、主线】
{lock}
"""


def respects_lock(lock: str, output: str) -> bool:
    source = (lock or "").strip()
    target = (output or "").strip()
    if len(source) < 40 or not target:
        return True
    anchors = [
        "蓝星",
        "龙国",
        "男主",
        "女主",
        "天骄",
        "零号",
        "星际",
        "秘境",
        "修炼",
        "系统",
        "穿越",
        "庶女",
        "将军府",
    ]
    needed = [word for word in anchors if word in source]
    if len(needed) < 2:
        return True
    hits = sum(1 for word in needed if word in target)
    return hits >= max(2, (len(needed) + 1) // 2)


def pack_material(
    content: str,
    *,
    ctx: WritingContext | None = None,
    kind: str = "chapter",
    brief: str = "",
) -> str:
    header = (brief or "").strip()
    if ctx is not None:
        header = (ctx.prompt_header or ContextAssembler().bible_brief(ctx)).strip()
        if brief:
            header = f"{header}\n{brief.strip()}"
        kind = kind or "chapter"
    label = KIND_LABELS.get(kind, kind)
    hint = KIND_HINTS.get(kind, "")
    lock_line = "改写时必须遵守上面的【作者原话锁定】和【修炼体系硬锁定】。跑题或自造境界等于失败。"
    return f"""素材类型：{label}
{hint}
{lock_line}
{header}

内容：
{content}
"""


def kind_for_step(step: str) -> str:
    return {
        "idea": "title",
        "naming": "title",
        "world": "world",
        "power": "power",
        "outline": "outline",
        "chapters": "outline",
        "bible": "bible",
        "writing": "copy",
        "polish": "copy",
        "preview": "copy",
    }.get(step or "idea", "copy")


def needs_copy_polish(text: str, tools: list[str]) -> bool:
    if any(
        name in {"write_chapter", "repolish_chapter", "repolish_saved", "chapter", "meta", "outline", "bible"}
        for name in tools
    ):
        return False
    stripped = (text or "").strip()
    return len(stripped) >= 30


def strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        lines = t.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    return t


def _short_consistency(ctx: WritingContext | None) -> str:
    if ctx is None:
        return ""
    novel = getattr(ctx, "novel", None)
    title = getattr(novel, "title", "") or ""
    genre = getattr(novel, "genre", "") or ""
    names = [
        getattr(c, "name", "")
        for c in (getattr(ctx, "characters", None) or [])
        if getattr(c, "name", "")
    ]
    bits = []
    if title:
        bits.append(f"书名：《{title}》")
    if genre:
        bits.append(f"类型：{genre}")
    if names:
        bits.append("男主：" + "、".join(names[:2]))
    from app.services.power_system import list_realms

    realms = list_realms(getattr(novel, "power_system", None) or "")
    if realms:
        bits.append("修炼境界只准用：" + "、".join(realms))
    return "。".join(bits)


def _revise_power_lock(ctx: WritingContext | None) -> str:
    if ctx is None:
        return ""
    from app.services.power_system import realm_lock_block

    return realm_lock_block(getattr(ctx.novel, "power_system", None) or "")


def build_revise_chat_messages(notes: str, content: str, *, ctx: WritingContext | None = None) -> list[dict[str, str]]:
    """按日常对话组织改写：先给已有正文，再给作者这一轮要求。"""
    notes = (notes or "").strip()
    content = (content or "").strip()
    intro = _short_consistency(ctx)
    lock = _revise_power_lock(ctx)
    head = f"{intro}。\n\n" if intro else ""
    lock_block = f"{lock}\n\n" if lock else ""
    return [
        {
            "role": "user",
            "content": (
                f"{head}{lock_block}"
                "下面是已经生成的一版正文，请先通读，后面我会说怎么改。"
                "通读时核对境界名称，表外等级视为错误。\n\n"
                f"{content}"
            ),
        },
        {
            "role": "assistant",
            "content": "已读完这一版正文，并记住修炼体系硬锁定。请直接说你想怎么改，我会在这一版基础上改写并只输出完整正文。",
        },
        {
            "role": "user",
            "content": (
                f"{notes}\n\n"
                f"{lock_block}"
                "请按上面的要求，在上一版正文基础上改写。\n"
                "必须严格遵守修炼体系：只许使用体系里已列出的境界，禁止出现表外等级；原文写错了就改回表内对应境界。\n"
                "只输出改写后的完整正文，不要解释。"
            ),
        },
    ]


def revise_needs_retry(notes: str, source: str, revised: str) -> bool:
    """作者有明确要求时，若输出空、或未要求删减却被砍到过短，则重跑。"""
    notes = (notes or "").strip()
    if not notes:
        return False
    src = len("".join((source or "").split()))
    out = len("".join((revised or "").split()))
    if out < 80:
        return True
    wants_expand = any(k in notes for k in ("扩写", "加长", "加细", "铺开", "写细", "补充", "交代", "写清楚"))
    wants_shorten_only = (
        any(k in notes for k in ("删掉", "删减", "缩短", "压缩", "就够了", "到此为止", "截止", "写到这"))
        and not wants_expand
    )
    if not wants_shorten_only and src > 200 and out < int(src * 0.4):
        return True
    return False


class ReviewAgent:
    name = "review"

    async def run(
        self,
        content: str,
        *,
        ctx: WritingContext | None = None,
        kind: str = "chapter",
        brief: str = "",
        thinking: bool = False,
    ) -> dict[str, Any]:
        data = await chat_json(
            system=_prompt("review_agent.md"),
            user=pack_material(content, ctx=ctx, kind=kind, brief=brief),
            temperature=0.3,
            thinking=thinking,
        )
        scores = data.get("scores") or {}
        keys = ["consistency", "character", "pacing", "hook", "dialogue", "ai_flavor"]
        clean_scores = {k: _as_int(scores.get(k)) for k in keys}
        values = [v for v in clean_scores.values() if v]
        overall = round(sum(values) / len(values), 1) if values else 0.0
        try:
            overall = float(data.get("overall") or overall)
        except (TypeError, ValueError):
            pass
        return {
            "scores": clean_scores,
            "overall": overall,
            "issues": data.get("issues") or [],
            "suggestions": data.get("suggestions") or [],
        }


class ReaderAgent:
    name = "reader"

    async def run(
        self,
        content: str,
        *,
        ctx: WritingContext | None = None,
        kind: str = "chapter",
        brief: str = "",
        thinking: bool = False,
    ) -> dict[str, Any]:
        data = await chat_json(
            system=_prompt("reader_agent.md"),
            user=pack_material(content, ctx=ctx, kind=kind, brief=brief),
            temperature=0.6,
            thinking=thinking,
        )
        scores = data.get("scores") or {}
        keys = ["attraction", "emotion", "curiosity", "payoff"]
        clean_scores = {k: _as_int(scores.get(k)) for k in keys}
        values = [v for v in clean_scores.values() if v]
        overall = round(sum(values) / len(values), 1) if values else 0.0
        return {
            "scores": clean_scores,
            "overall": overall,
            "would_continue": bool(data.get("would_continue")),
            "one_liner": data.get("one_liner") or "",
            "complaints": data.get("complaints") or [],
            "praise": data.get("praise") or [],
        }


class DeAIAgent:
    name = "deai"

    async def stream(
        self,
        content: str,
        *,
        ctx: WritingContext | None = None,
        kind: str = "chapter",
        brief: str = "",
        thinking: bool = False,
        on_reasoning=None,
    ):
        user = pack_material(content, ctx=ctx, kind=kind, brief=brief)
        async for token in chat_stream(
            system=_prompt("deai_agent.md"),
            user=user,
            temperature=0.7,
            thinking=thinking,
            on_reasoning=on_reasoning,
        ):
            yield token

    async def run_json(
        self,
        content: str,
        *,
        kind: str,
        brief: str = "",
        review: dict[str, Any] | None = None,
        system_name: str = "deai_agent.md",
    ) -> dict[str, Any]:
        user = pack_material(content, kind=kind, brief=brief)
        if review:
            user += "\n\n审查报告：\n" + json.dumps(review, ensure_ascii=False)
        extra = "\n\n本次必须只返回 JSON，结构与输入一致，只改写其中的中文文案，不要增删字段。"
        return await chat_json(
            system=_prompt(system_name) + extra,
            user=user,
            temperature=0.65,
            max_tokens=8192,
        )


class CoherenceAgent:
    """已写章节梳理：克制文风、战力/人物连贯、接上一章结尾。"""

    name = "coherence"

    async def stream(
        self,
        content: str,
        *,
        user: str,
        thinking: bool = False,
        on_reasoning=None,
    ):
        async for token in chat_stream(
            system=_prompt("coherence_agent.md"),
            user=user,
            temperature=0.45,
            max_tokens=16384,
            thinking=thinking,
            on_reasoning=on_reasoning,
        ):
            yield token


class ReviseAgent:
    name = "revise"

    async def stream(
        self,
        content: str,
        review: dict[str, Any] | None = None,
        *,
        ctx: WritingContext | None = None,
        kind: str = "chapter",
        brief: str = "",
        author_notes: str = "",
        thinking: bool = False,
        on_reasoning=None,
    ):
        notes = (author_notes or "").strip()
        if notes:
            # 对话式改写：作者要求 + 已有正文，不塞大纲/审查，避免盖住原话
            async for token in chat_stream(
                system=_prompt("revise_agent.md"),
                messages=build_revise_chat_messages(notes, content, ctx=ctx),
                temperature=0.55,
                max_tokens=16384,
                thinking=thinking,
                on_reasoning=on_reasoning,
            ):
                yield token
            return

        user = pack_material(content, ctx=ctx, kind=kind, brief=brief)
        if review:
            user += "\n\n审查报告（辅助参考）：\n" + json.dumps(review, ensure_ascii=False)
        else:
            user += "\n\n请在保持主线的前提下润色本章：加强钩子、压缩套话、让对话更有人物感。"
        async for token in chat_stream(
            system=_prompt("revise_agent.md"),
            user=user,
            temperature=0.7,
            max_tokens=8192,
            thinking=thinking,
            on_reasoning=on_reasoning,
        ):
            yield token


class ContinuityAgent:
    """章间接力硬门：对照上一章结尾校验本章开场是否真正承接。"""

    name = "continuity"
    PASS_SCORE = 7

    async def run(
        self,
        content: str,
        *,
        prev_ending: str = "",
        plot_brief: str = "",
        scene_plan: str = "",
        chapter_number: int = 1,
        thinking: bool = False,
    ) -> dict[str, Any]:
        ending = (prev_ending or "").strip()
        body = (content or "").strip()
        if (chapter_number or 1) <= 1 or not ending:
            hook = (
                "本章为开篇无需接力"
                if (chapter_number or 1) <= 1
                else "无上一章结尾，跳过接力校验"
            )
            return {
                "pass": True,
                "score": 10,
                "prev_hook": hook,
                "opening_ok": True,
                "issues": [],
                "revise_notes": "",
            }
        opening = body[:800] if len(body) > 800 else body
        user = f"""上一章结尾（必须承接）：
{ending}

本章剧情要点：
{(plot_brief or "").strip() or "（无）"}

本章场景规划（若有，看第一场是否接钩子）：
{(scene_plan or "").strip() or "（无）"}

本章正文开场（前约 800 字）：
{opening or "（空）"}
"""
        data = await chat_json(
            system=_prompt("continuity_agent.md"),
            user=user,
            temperature=0.2,
            thinking=thinking,
        )
        if not isinstance(data, dict):
            data = {}
        score = _as_int(data.get("score"), 0)
        opening_ok = bool(data.get("opening_ok"))
        passed = bool(data.get("pass")) and opening_ok and score >= self.PASS_SCORE
        issues = data.get("issues") or []
        if not isinstance(issues, list):
            issues = [str(issues)]
        notes = str(data.get("revise_notes") or "").strip()
        if not passed and not notes:
            notes = (
                "开场没有承接上一章结尾钩子。请改写本章前 300–600 字："
                "先落地上一章未收束的状态/悬念，再进入本章新冲突；不要开篇换场地空降。"
            )
        return {
            "pass": passed,
            "score": score,
            "prev_hook": str(data.get("prev_hook") or "").strip(),
            "opening_ok": opening_ok if passed else False,
            "issues": [str(x) for x in issues if str(x).strip()],
            "revise_notes": notes if not passed else "",
        }
