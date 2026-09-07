from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, select

from app.models import Chapter, Character, Event, Item, Location, Novel, Relationship, Season


def word_count(text: str) -> int:
    return len("".join(text.split()))


def power_system_block(novel: Any, *, missing: str = "（未填）") -> str:
    """每次写章/对话都注入的战力体系，保证境界与对决不跳级、不自造等级。"""
    from app.services.cast_scrub import redact_for_prompt
    from app.services.power_system import format_power_system, realm_lock_block

    raw = redact_for_prompt(getattr(novel, "power_system", None) or "", novel)
    lock = realm_lock_block(raw)
    text = format_power_system(raw, missing=missing)
    return f"""【修炼/战力体系｜写境界、对决、升级时必须遵守，禁止跳级、禁止自造等级】
{lock}

完整体系：
{text}"""


def ending_excerpt(text: str, limit: int = 600) -> str:
    compact = text.strip()
    if len(compact) <= limit:
        return compact
    return compact[-limit:]


def is_protagonist(char: Any) -> bool:
    """判断是否为男主/主角（写章时只注入这一人，其余角色锁定后才入库）。"""
    role = (getattr(char, "role", None) or "").strip()
    if not role:
        return False
    if any(key in role for key in ("男主", "主角", "主人公")):
        return True
    # 常见写法：role=「主角 林舟」或「男主」
    return role in ("主",) or role.startswith("主角") or role.startswith("男主")


def filter_protagonist(chars: list[Any]) -> list[Any]:
    """写章/规划只带男主；没有标注时退回空列表（让模型按灵感写，不锁死配角表）。"""
    leads = [c for c in chars if is_protagonist(c)]
    if leads:
        return leads[:1]
    # 仅一人且像主角名时也可当作男主，避免空列表
    named = [c for c in chars if (getattr(c, "name", None) or "").strip()]
    if len(named) == 1:
        return named
    return []


@dataclass
class WritingContext:
    novel: Novel
    chapter: Chapter
    mode: str
    instruction: str
    target_words: int
    outline: str
    characters: list[Character] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    locations: list[Location] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    recent_summaries: list[tuple[int, str, str]] = field(default_factory=list)
    prev_ending: str = ""
    prompt_header: str = ""
    scene_plan: str = ""
    season_brief: str = ""


class ContextAssembler:
    def assemble(
        self,
        session: Session,
        *,
        novel: Novel,
        chapter: Chapter,
        mode: str,
        instruction: str,
        target_words: int,
        character_ids: list[int],
    ) -> WritingContext:
        chars = list(session.exec(select(Character).where(Character.novel_id == novel.id)).all())
        if character_ids:
            id_set = set(character_ids)
            chars = [c for c in chars if c.id in id_set] or chars
        leads = filter_protagonist(chars)
        # 男主必须在；已入库配角一并带上，保证姓名/修为连贯
        if leads:
            lead_ids = {c.id for c in leads}
            extras = [c for c in chars if c.id not in lead_ids and (c.name or "").strip()]
            chars = leads + extras[:16]
        else:
            chars = [c for c in chars if (c.name or "").strip()][:16]

        from app.services.cast_scrub import redact_for_prompt

        instruction = redact_for_prompt(instruction.strip(), novel)

        prev_chapters = session.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel.id, Chapter.number < chapter.number)
            .order_by(Chapter.number.desc())
        ).all()

        recent = []
        prev_ending = ""
        for idx, ch in enumerate(prev_chapters):
            if idx == 0:
                prev_ending = redact_for_prompt(ending_excerpt(ch.content), novel)
            if idx < 3 and (ch.summary or ch.content):
                raw_sum = ch.summary or ending_excerpt(ch.content, 200)
                recent.append((ch.number, ch.title, redact_for_prompt(raw_sum, novel)))

        recent.reverse()

        outline_raw = novel.outline_json or "[]"
        outline = redact_for_prompt(outline_raw, novel)
        season_brief = self._season_brief(session, novel.id or 0, chapter.number or 0)

        ctx = WritingContext(
            novel=novel,
            chapter=chapter,
            mode=mode,
            instruction=instruction.strip(),
            target_words=target_words,
            outline=outline,
            characters=chars,
            # 关系表也不注入写章，避免配角名单间接限制剧情；锁定收录后再维护
            relationships=[],
            items=session.exec(select(Item).where(Item.novel_id == novel.id)).all(),
            locations=session.exec(select(Location).where(Location.novel_id == novel.id)).all(),
            events=session.exec(select(Event).where(Event.novel_id == novel.id, Event.resolved.is_(False))).all(),
            recent_summaries=recent,
            prev_ending=prev_ending,
            season_brief=season_brief,
        )
        ctx.prompt_header = (
            self.bible_brief(ctx)
            + f"\n\n本章标题：第{chapter.number}章《{chapter.title or '未命名'}》"
        )
        return ctx

    def _season_brief(self, session: Session, novel_id: int, chapter_number: int) -> str:
        if not novel_id or not chapter_number:
            return ""
        rows = session.exec(select(Season).where(Season.novel_id == novel_id)).all()
        hit = next(
            (
                s
                for s in rows
                if int(s.start_number or 0) <= chapter_number <= int(s.end_number or 0)
            ),
            None,
        )
        if not hit:
            return ""
        lines = [f"第{hit.number}季「{hit.theme}」（第{hit.start_number}–{hit.end_number}章）"]
        if hit.intro:
            lines.append(f"本季介绍：{hit.intro}")
        if hit.summary:
            lines.append(f"本季主线：{hit.summary}")
        if chapter_number == hit.start_number and hit.intro:
            lines.append("本章是本季开幕：先落地介绍与舞台，不要跳到决赛。")
        if chapter_number == hit.end_number and hit.season_hook:
            lines.append(f"本章是本季收束：必须留下季末钩子——{hit.season_hook}")
        elif hit.season_hook:
            lines.append(f"季末钩子（本章不要提前揭完）：{hit.season_hook}")
        lines.append("节奏：不是每章都要爆点；缓章用观察/恢复/对话，高潮章才升级冲突。")
        return "\n".join(lines)

    def to_user_prompt(self, ctx: WritingContext) -> str:
        char_block = "\n".join(
            (
                f"- {c.name}｜身份:{c.role or '未标'}｜性格:{c.personality or '未填'}"
                f"｜能力:{c.abilities or '无'}｜当前状态:{c.status_text or '未知'}"
                f"｜背景:{c.background or '无'}"
            )
            for c in ctx.characters
        ) or "（尚未登记男主；请按灵感原话确定男主姓名，禁止另起一套主角）"

        item_block = "\n".join(f"- {i.name}：{i.description}（持有者:{i.owner or '未知'}）" for i in ctx.items) or "（无）"
        loc_block = "\n".join(f"- {loc.name}：{loc.description}" for loc in ctx.locations) or "（无）"
        event_block = "\n".join(
            f"- {e.name}（时间:{e.timeline or '未标'}）：{e.description}" for e in ctx.events
        ) or "（无未收束事件）"

        summary_block = "\n".join(
            f"- 第{num}章《{title}》：{summary}" for num, title, summary in ctx.recent_summaries
        ) or "（本书第一章或前文无摘要）"

        from app.services.outline import beat_for_chapter

        beat = beat_for_chapter(ctx.outline, ctx.chapter.number)
        beat_line = f"本章大纲要点：{beat}" if beat else "本章大纲要点：（无，按指令或抽卡推进）"
        instruction = ctx.instruction or beat or "（用户未写指令，按大纲推进）"

        mode_line = (
            "抽卡模式：基于当前状态自动推进，允许一次意外转折；仍须按下方场景表慢写，不要一笔带过。"
            if ctx.mode == "lottery"
            else f"剧情模式：必须完成以下指令：{instruction}"
        )

        plan_block = ""
        if (ctx.scene_plan or "").strip():
            plan_block = f"""
【本章场景规划｜必须按顺序展开，禁止把多场戏压成一段赶剧情】
{ctx.scene_plan.strip()}
"""

        bridge_block = ""
        if (ctx.prev_ending or "").strip():
            bridge_block = f"""
【章间接力｜开场硬约束】
上一章必须承接的结尾（勿跳过）：
{ctx.prev_ending.strip()}
- 本章前 300–600 字必须先落地该结尾的悬念/状态（时间线、地点、男主处境、未收束事件），再开新冲突。
- 禁止开篇换场地空降、禁止跳过钩子另起炉灶。已出场配角不要改名，事件与状态必须接上。
"""

        season_block = ""
        if (ctx.season_brief or "").strip():
            season_block = f"""
【本季剧集｜本章属于这一季，不要写到下一季正戏】
{ctx.season_brief.strip()}
"""

        return f"""书名：{ctx.novel.title}
类型：{ctx.novel.genre or '未定'}
简介：{ctx.novel.description}
世界观：
{ctx.novel.world_bible or '（未填）'}
{power_system_block(ctx.novel)}
{season_block}

大纲 JSON：
{ctx.outline}

当前章节：第{ctx.chapter.volume}卷第{ctx.chapter.number}章《{ctx.chapter.title or '未命名'}》
{beat_line}
目标字数：约 {ctx.target_words} 字（正文不得明显短于该字数）
{mode_line}
{plan_block}
{bridge_block}
【男主｜姓名性别人设不可改】
{char_block}
- 上表第一人是男主。其余为已出场人物：姓名、身份、修为必须连贯，禁止改名或换成另一个人顶替。
- 本章可以新出场配角，必须给姓名和一句辨识。
- 不要整章只围着男主自说自话；也不要用「有个男人/一名学生」代替可写的配角。
- 写境界时只准用体系表内名称；「星芒印记」是印记，不是星芒境。

道具：
{item_block}

场景：
{loc_block}

未收束事件：
{event_block}

近章摘要：
{summary_block}

上一章结尾：
{ctx.prev_ending or '（无）'}
"""

    def bible_brief(self, ctx: WritingContext) -> str:
        chars = "\n".join(
            f"- {c.name}｜{c.role or '未标'}｜性格:{c.personality or '未填'}｜状态:{c.status_text or '未知'}"
            for c in ctx.characters
        ) or "（尚未登记男主）"
        summaries = "\n".join(
            f"- 第{num}章《{title}》：{summary}" for num, title, summary in ctx.recent_summaries
        ) or "（无）"
        return f"""书名：{ctx.novel.title}
类型：{ctx.novel.genre or '未定'}
简介：{ctx.novel.description}
世界观：
{ctx.novel.world_bible or '（未填）'}
{power_system_block(ctx.novel)}
男主（写章只锁定此人，其余角色锁定章节后收录）：
{chars}
近章摘要：
{summaries}"""
