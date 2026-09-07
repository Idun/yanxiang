from __future__ import annotations

from pathlib import Path
from typing import Any

from app.llm.deepseek import chat_json
from app.models import Novel
from app.services.context import WritingContext, power_system_block

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"


def _prompt(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8").strip()


def _novel_brief(novel: Novel) -> str:
    return f"""书名：{novel.title}
类型：{novel.genre or '未定'}
灵感：{novel.premise}
简介：{novel.description}
世界观：
{novel.world_bible or '（未填）'}
{power_system_block(novel)}
现有大纲 JSON：
{novel.outline_json or '[]'}
"""


def format_scene_plan(data: dict[str, Any]) -> str:
    """把规划 JSON 排成写作 Agent 可读的场景表。"""
    if not isinstance(data, dict):
        return ""
    lines: list[str] = []
    focus = (data.get("focus") or "").strip()
    pacing = (data.get("pacing") or "slow").strip()
    if focus:
        lines.append(f"本章核心冲突（只推进这一条）：{focus}")
    role = (data.get("role") or "").strip()
    if role:
        role_cn = {
            "breath": "缓章",
            "setup": "铺垫",
            "escalate": "升温",
            "payoff": "兑现",
            "aftermath": "余波",
        }.get(role, role)
        lines.append(f"本章定位：{role_cn}（读者会疲劳，按定位控制冲突等级）")
    lines.append(f"节奏要求：{pacing}（禁止赶剧情，用场面与对话把字数铺开）")
    must_not = data.get("must_not") or []
    if isinstance(must_not, list) and must_not:
        lines.append("本章禁止提前发生：")
        for item in must_not:
            if str(item).strip():
                lines.append(f"- {str(item).strip()}")
    scenes = data.get("scenes") or []
    if isinstance(scenes, list) and scenes:
        lines.append("场景表（按顺序写满，不要合并跳场）：")
        for raw in scenes:
            if not isinstance(raw, dict):
                continue
            order = raw.get("order") or ""
            title = (raw.get("title") or "场景").strip()
            words = raw.get("approx_words") or ""
            purpose = (raw.get("purpose") or "").strip()
            setting = (raw.get("setting") or "").strip()
            emotion = (raw.get("emotion") or "").strip()
            lines.append(f"\n【场景{order}】{title}｜约{words}字｜作用：{purpose}")
            if setting:
                lines.append(f"场景：{setting}")
            if emotion:
                lines.append(f"情绪：{emotion}")
            beats = raw.get("beats") or []
            if isinstance(beats, list):
                for beat in beats:
                    if str(beat).strip():
                        lines.append(f"· {str(beat).strip()}")
    hook = (data.get("chapter_hook") or "").strip()
    if hook:
        lines.append(f"\n章末钩子：{hook}")
    notes = (data.get("writing_notes") or "").strip()
    if notes:
        lines.append(f"写作提醒：{notes}")
    new_cast = data.get("new_cast") or []
    if isinstance(new_cast, list) and new_cast:
        lines.append("本章可新出场（必须写进正文并给姓名，不要只用「有人」）：")
        for raw in new_cast:
            if isinstance(raw, dict):
                name = (raw.get("name") or "未名").strip()
                role = (raw.get("role") or "").strip()
                purpose = (raw.get("purpose") or "").strip()
                bit = f"- {name}"
                if role:
                    bit += f"｜{role}"
                if purpose:
                    bit += f"：{purpose}"
                lines.append(bit)
            elif str(raw).strip():
                lines.append(f"- {str(raw).strip()}")
    return "\n".join(lines).strip()


class OutlineAgent:
    name = "outline"

    async def run(self, novel: Novel, *, chapter_count: int = 30, instruction: str = "") -> dict[str, Any]:
        extra = instruction.strip() or "按番茄连载节奏展开。"
        user = _novel_brief(novel) + f"\n目标章数：约 {chapter_count} 章\n补充要求：{extra}"
        return await chat_json(
            system=_prompt("outline_agent.md"),
            user=user,
            temperature=0.7,
            max_tokens=8192,
        )


class ArcPlanAgent:
    """剧集规划：把「全国大比」等阶段性事件拆成一季连续多章，并预告下一季。"""

    name = "arc"

    async def run(
        self,
        novel: Novel,
        *,
        theme: str,
        chapter_count: int = 8,
        start_number: int = 1,
        instruction: str = "",
        recent_context: str = "",
        prev_theme: str = "",
        prev_hook: str = "",
        prev_next_preview: str = "",
        season_number: int = 1,
        thinking: bool = False,
    ) -> dict[str, Any]:
        theme = (theme or "").strip() or "阶段性大事件"
        start_number = max(int(start_number or 1), 1)
        chapter_count = min(max(int(chapter_count or 8), 3), 30)
        extra = (instruction or "").strip() or "按番茄连载节奏，慢推本季大事件。"
        recent = (recent_context or "").strip() or "（无）"
        prev_block = "（本书第一季，无需承接上季）"
        if (prev_theme or prev_hook or prev_next_preview).strip():
            prev_block = f"""上一季主题：{prev_theme or "（未标）"}
上一季季末钩子（本季开场必须接）：{prev_hook or "（无）"}
上一季留下的下一季预告（可 refinement）：{prev_next_preview or "（无）"}"""
        user = (
            _novel_brief(novel)
            + f"""
本季序号：第 {season_number} 季
本季主题：{theme}
起始章号：{start_number}
本季章数：{chapter_count}（章号 {start_number}–{start_number + chapter_count - 1}）
作者补充要求：{extra}

{prev_block}

近章摘要 / 当前进度（本季必须承接，不要推翻）：
{recent}
"""
        )
        data = await chat_json(
            system=_prompt("arc_agent.md"),
            user=user,
            temperature=0.65,
            max_tokens=8192,
            thinking=thinking,
        )
        if not isinstance(data, dict):
            return {
                "theme": theme,
                "intro": "",
                "arc_summary": "",
                "season_hook": "",
                "next_theme": "",
                "next_preview": "",
                "start_number": start_number,
                "chapters": [],
            }
        rows_in = data.get("chapters") or []
        cleaned: list[dict[str, Any]] = []
        if isinstance(rows_in, list):
            for idx, raw in enumerate(rows_in):
                if not isinstance(raw, dict):
                    continue
                num = int(raw.get("number") or (start_number + idx))
                cleaned.append(
                    {
                        "number": num,
                        "title": str(raw.get("title") or "").strip(),
                        "summary": str(raw.get("summary") or "").strip(),
                    }
                )
        for idx, row in enumerate(cleaned):
            row["number"] = start_number + idx
        cleaned = cleaned[:chapter_count]
        while len(cleaned) < chapter_count:
            n = start_number + len(cleaned)
            cleaned.append({"number": n, "title": f"{theme}·续", "summary": ""})
        intro = str(data.get("intro") or "").strip()
        if intro and cleaned:
            first = cleaned[0]
            if not (first.get("summary") or "").strip():
                first["summary"] = intro
            if not (first.get("title") or "").strip():
                first["title"] = f"{theme}开幕"
        return {
            "theme": str(data.get("theme") or theme).strip() or theme,
            "intro": intro,
            "arc_summary": str(data.get("arc_summary") or "").strip(),
            "season_hook": str(data.get("season_hook") or "").strip(),
            "next_theme": str(data.get("next_theme") or "").strip(),
            "next_preview": str(data.get("next_preview") or "").strip(),
            "start_number": start_number,
            "chapters": cleaned,
        }


ROLE_LABELS = {
    "breath": "缓章",
    "setup": "铺垫",
    "escalate": "升温",
    "payoff": "兑现",
    "aftermath": "余波",
}


def decorate_plot_summary(role: str, summary: str) -> str:
    summary = (summary or "").strip()
    label = ROLE_LABELS.get((role or "").strip(), "")
    if not label:
        return summary
    if summary.startswith("【") and "】" in summary[:12]:
        return summary
    return f"【{label}】{summary}"


class VolumeSeasonAgent:
    """一卷先定季数与主线，再允许拆章。"""

    name = "volume_season"

    async def run(
        self,
        novel: Novel,
        *,
        volume: int = 1,
        volume_title: str = "",
        volume_summary: str = "",
        start_number: int = 1,
        end_number: int = 20,
        written_digest: str = "",
        instruction: str = "",
        thinking: bool = False,
    ) -> dict[str, Any]:
        extra = (instruction or "").strip() or "本卷先把季定完；不要把全国大比提前。"
        user = (
            _novel_brief(novel)
            + f"""
本卷序号：第 {volume} 卷
本卷标题：{volume_title or "（未标）"}
本卷已有摘要：{volume_summary or "（未填）"}
本卷章节区间：第 {start_number}–{end_number} 章（必须被各季连续覆盖）

作者补充：
{extra}

已写章节摘要 / 超前剧情（规划可以纠正超前跳季）：
{written_digest or "（尚无正文）"}
"""
        )
        data = await chat_json(
            system=_prompt("volume_season_agent.md"),
            user=user,
            temperature=0.55,
            max_tokens=8192,
            thinking=thinking,
        )
        if not isinstance(data, dict):
            return {"volume": volume, "volume_title": volume_title, "volume_arc": "", "seasons": []}
        rows_in = data.get("seasons") or []
        seasons: list[dict[str, Any]] = []
        if isinstance(rows_in, list):
            for idx, raw in enumerate(rows_in):
                if not isinstance(raw, dict):
                    continue
                start = int(raw.get("start_number") or 0)
                end = int(raw.get("end_number") or 0)
                if start <= 0 or end < start:
                    continue
                seasons.append(
                    {
                        "number": int(raw.get("number") or (idx + 1)),
                        "theme": str(raw.get("theme") or "").strip() or f"第{idx + 1}季",
                        "intro": str(raw.get("intro") or "").strip(),
                        "arc_summary": str(raw.get("arc_summary") or "").strip(),
                        "season_hook": str(raw.get("season_hook") or "").strip(),
                        "next_theme": str(raw.get("next_theme") or "").strip(),
                        "next_preview": str(raw.get("next_preview") or "").strip(),
                        "start_number": start,
                        "end_number": end,
                        "pacing_note": str(raw.get("pacing_note") or "").strip(),
                    }
                )
        seasons.sort(key=lambda s: (s["start_number"], s["number"]))
        for idx, row in enumerate(seasons):
            row["number"] = idx + 1
        return {
            "volume": int(data.get("volume") or volume),
            "volume_title": str(data.get("volume_title") or volume_title).strip() or volume_title,
            "volume_arc": str(data.get("volume_arc") or "").strip(),
            "seasons": seasons,
        }


class ChapterPlotAgent:
    """按已定季结构给区间内每章写剧情要点（含缓章定位）。"""

    name = "chapter_plot"

    async def run(
        self,
        novel: Novel,
        *,
        season: dict[str, Any],
        chapters_digest: str,
        instruction: str = "",
        thinking: bool = False,
    ) -> list[dict[str, Any]]:
        start = int(season.get("start_number") or 1)
        end = int(season.get("end_number") or start)
        extra = (instruction or "").strip()
        user = (
            _novel_brief(novel)
            + f"""
本季序号：第 {season.get("number") or 1} 季
本季主题：{season.get("theme") or ""}
本季介绍：{season.get("intro") or ""}
本季主线：{season.get("arc_summary") or ""}
季末钩子：{season.get("season_hook") or ""}
下一季预告：{season.get("next_theme") or ""}｜{season.get("next_preview") or ""}
节奏备忘：{season.get("pacing_note") or "不是每章都有爆点"}
必须覆盖章号：第 {start}–{end} 章

作者补充：
{extra or "按本季主题重梳；已写正文若提前全国大比则改回本季该有的戏。"}

各章现状（标题 / 是否已有正文 / 旧要点）：
{chapters_digest or "（无）"}
"""
        )
        data = await chat_json(
            system=_prompt("chapter_plot_agent.md"),
            user=user,
            temperature=0.55,
            max_tokens=8192,
            thinking=thinking,
        )
        rows_in = data.get("chapters") if isinstance(data, dict) else []
        cleaned: list[dict[str, Any]] = []
        if isinstance(rows_in, list):
            for idx, raw in enumerate(rows_in):
                if not isinstance(raw, dict):
                    continue
                num = int(raw.get("number") or (start + idx))
                role = str(raw.get("role") or "setup").strip() or "setup"
                if role not in ROLE_LABELS:
                    role = "setup"
                cleaned.append(
                    {
                        "number": num,
                        "title": str(raw.get("title") or "").strip(),
                        "role": role,
                        "summary": decorate_plot_summary(
                            role, str(raw.get("summary") or "").strip()
                        ),
                    }
                )
        by_num = {int(r["number"]): r for r in cleaned}
        filled: list[dict[str, Any]] = []
        for n in range(start, end + 1):
            row = by_num.get(n)
            if row:
                filled.append(row)
            else:
                filled.append(
                    {
                        "number": n,
                        "title": f"{season.get('theme') or '本季'}·续",
                        "role": "breath",
                        "summary": decorate_plot_summary(
                            "breath", "缓章：承接前文状态，只做观察、恢复或对话，不安排大战。"
                        ),
                    }
                )
        return filled


class BibleAgent:
    name = "bible"

    async def run(self, novel: Novel) -> dict[str, Any]:
        return await chat_json(
            system=_prompt("bible_agent.md"),
            user=_novel_brief(novel),
            temperature=0.6,
            max_tokens=8192,
        )


class ContentPlanAgent:
    """章内内容规划：把粗大纲要点拆成慢节奏场景表。"""

    name = "content_plan"

    async def run(self, ctx: WritingContext, *, thinking: bool = False) -> dict[str, Any]:
        from app.services.outline import beat_for_chapter

        beat = beat_for_chapter(ctx.outline, ctx.chapter.number)
        next_beat = beat_for_chapter(ctx.outline, (ctx.chapter.number or 1) + 1)
        summaries = "\n".join(
            f"- 第{num}章《{title}》：{summary}" for num, title, summary in ctx.recent_summaries
        ) or "（无）"
        chars = "\n".join(
            f"- {c.name}｜{c.role or '未标'}｜{c.personality or ''}" for c in ctx.characters[:3]
        ) or "（尚未登记男主）"
        user = f"""书名：{ctx.novel.title}
类型：{ctx.novel.genre or '未定'}
简介：{ctx.novel.description}
世界观：
{ctx.novel.world_bible or '（未填）'}
{power_system_block(ctx.novel)}
{f'''
本季剧集：
{ctx.season_brief.strip()}
''' if (ctx.season_brief or '').strip() else ''}

当前章节：第{ctx.chapter.volume}卷第{ctx.chapter.number}章《{ctx.chapter.title or '未命名'}》
本章大纲要点：{beat or '（无）'}
作者/剧情指令：{ctx.instruction or '（无，按大纲要点）'}
目标字数：约 {ctx.target_words} 字
写作模式：{ctx.mode}

下一章已有大纲草稿（可 refinement，不要跑题）：{next_beat or '（尚无，请新建下一章标题与剧情）'}

男主（写章只锁定此人，禁止改名改性别；配角不要查角色表，需要谁就规划进 new_cast）：
{chars}

近章摘要：
{summaries}

上一章结尾：
{ctx.prev_ending or '（无）'}

请输出慢节奏场景计划 JSON，并必须包含 next_chapter（下一章标题 + 大致剧情）。
记住：本章剧情不要太快；若指令带【缓章】【铺垫】【余波】则禁止生死战。下一章只承接本章钩子往前一小步，高潮后必须接缓章。已出场配角沿用原名；需要新配角再起新姓名。禁止把全国大比等尚未开始的下一卷舞台写进本章或下一章。读者要一眼看懂场景计划里每场在干什么。
"""
        data = await chat_json(
            system=_prompt("content_plan_agent.md"),
            user=user,
            temperature=0.55,
            # 深度思考会占用输出预算，过小易截断 JSON，导致 next_chapter 丢失
            max_tokens=8192 if thinking else 4096,
            thinking=thinking,
        )
        if not isinstance(data, dict):
            return {"raw": data, "formatted": ""}
        data["formatted"] = format_scene_plan(data)
        next_ch = data.get("next_chapter")
        if isinstance(next_ch, dict):
            data["next_chapter"] = {
                "title": str(next_ch.get("title") or "").strip(),
                "summary": str(next_ch.get("summary") or "").strip(),
            }
        return data


class NextChapterAgent:
    """本章优化后，按新正文重算下一章标题与剧情要点。"""

    name = "next_chapter"

    async def run(
        self,
        *,
        novel: Novel,
        chapter_number: int,
        chapter_title: str,
        chapter_content: str,
        author_notes: str = "",
        existing_next: str = "",
    ) -> dict[str, Any]:
        body = (chapter_content or "").strip()
        ending = body[-4000:] if len(body) > 4000 else body
        notes = (author_notes or "").strip()
        notes_block = notes or "（作者这一轮没有额外说明，按改写后正文结尾衔接）"
        user = f"""【作者这一轮的改写要求｜下一章主要内容必须承接，提到下一章/第二章的话必须写进 summary】
{notes_block}

书名：{novel.title}
类型：{novel.genre or '未定'}
简介：{novel.description}
世界观：
{novel.world_bible or '（未填）'}
{power_system_block(novel)}

刚改写完的章节：第{chapter_number}章《{chapter_title or '未命名'}》
旧的下一章主要内容（过时，仅供对照，禁止照抄）：{existing_next or '（无）'}

改写后的正文结尾（下一章必须从这里接着写）：
{ending}
"""
        data = await chat_json(
            system=_prompt("next_chapter_agent.md"),
            user=user,
            temperature=0.5,
            max_tokens=1024,
        )
        if not isinstance(data, dict):
            return {}
        return {
            "title": str(data.get("title") or "").strip(),
            "summary": str(data.get("summary") or "").strip(),
        }


class RelationshipSyncAgent:
    """从正文自动抽取/更新人物关系。"""

    name = "relationship_sync"

    async def run(
        self,
        *,
        novel: Novel,
        characters: list[Any],
        chapter_content: str,
        existing_relationships: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        names = [getattr(c, "name", "") for c in characters if getattr(c, "name", "")]
        if len(names) < 1:
            return {"relationships": []}
        char_lines = "\n".join(
            f"- {getattr(c, 'name', '')}｜{getattr(c, 'role', '') or '未标'}｜{getattr(c, 'personality', '') or ''}"
            for c in characters
            if getattr(c, "name", "")
        )
        old = existing_relationships or []
        old_lines = (
            "\n".join(
                f"- {r.get('from_name')} → {r.get('to_name')}（{r.get('relation_type')}）{r.get('description') or ''}"
                for r in old
            )
            or "（尚无）"
        )
        body = (chapter_content or "").strip()
        if len(body) > 6000:
            body = body[:2000] + "\n…\n" + body[-3500:]
        user = f"""书名：{novel.title}
类型：{novel.genre or '未定'}

已有角色（只能用这些名字）：
{char_lines}

已有关系：
{old_lines}

本章正文：
{body}

请输出需要新增或更新的 relationships JSON。
"""
        data = await chat_json(
            system=_prompt("relationship_agent.md"),
            user=user,
            temperature=0.35,
            max_tokens=2048,
        )
        if not isinstance(data, dict):
            return {"relationships": []}
        rows = data.get("relationships") or []
        if not isinstance(rows, list):
            return {"relationships": []}
        cleaned: list[dict[str, str]] = []
        allowed = set(names)
        for item in rows:
            if not isinstance(item, dict):
                continue
            a = str(item.get("from_name") or "").strip()
            b = str(item.get("to_name") or "").strip()
            if a not in allowed or b not in allowed or a == b:
                continue
            cleaned.append(
                {
                    "from_name": a,
                    "to_name": b,
                    "relation_type": str(item.get("relation_type") or "").strip() or "相关",
                    "description": str(item.get("description") or "").strip(),
                }
            )
        return {"relationships": cleaned}


class CharacterHarvestAgent:
    """从正文收录新出场有名角色，不覆盖核心班底。"""

    name = "character_harvest"

    async def run(
        self,
        *,
        novel: Novel,
        characters: list[Any],
        chapter_content: str,
    ) -> dict[str, Any]:
        names = [getattr(c, "name", "") for c in characters if getattr(c, "name", "")]
        char_lines = "\n".join(
            f"- {getattr(c, 'name', '')}｜{getattr(c, 'role', '') or '未标'}"
            for c in characters
            if getattr(c, "name", "")
        ) or "（尚无）"
        body = (chapter_content or "").strip()
        if len(body) < 80:
            return {"characters": []}
        if len(body) > 7000:
            body = body[:2200] + "\n…\n" + body[-4000:]
        user = f"""书名：{novel.title}
类型：{novel.genre or '未定'}

已有角色（不要重复收录）：
{char_lines}

本章正文：
{body}

请输出本章新出场、有姓名、且不在已有名单里的角色 JSON。
"""
        data = await chat_json(
            system=_prompt("character_harvest_agent.md"),
            user=user,
            temperature=0.3,
            max_tokens=2048,
        )
        if not isinstance(data, dict):
            return {"characters": []}
        rows = data.get("characters") or []
        if not isinstance(rows, list):
            return {"characters": []}
        allowed_skip = {n for n in names if n}
        cleaned: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in rows:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name or name in seen:
                continue
            if any(
                old == name or (len(old) >= 2 and old in name) or (len(name) >= 2 and name in old)
                for old in allowed_skip
            ):
                continue
            seen.add(name)
            cleaned.append(
                {
                    "name": name,
                    "role": str(item.get("role") or "配角").strip() or "配角",
                    "personality": str(item.get("personality") or "").strip(),
                    "background": str(item.get("background") or "").strip(),
                    "abilities": str(item.get("abilities") or "").strip(),
                    "status_text": str(item.get("status_text") or "").strip(),
                    "appearance_notes": str(item.get("appearance_notes") or "").strip(),
                }
            )
            if len(cleaned) >= 6:
                break
        return {"characters": cleaned}
