from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.agents.planning import ArcPlanAgent, BibleAgent, ChapterPlotAgent, OutlineAgent, VolumeSeasonAgent
from app.agents.workshop import novel_brief
from app.db import get_session
from app.llm.deepseek import DeepSeekError
from app.schemas import ArcPlanIn, OutlinePlanIn, SeasonNextIn, VolumePlanIn
from app.services import novels as novel_svc
from app.services import planning as plan_svc
from app.services import chapters as chapter_svc
from app.services.outline import parse_outline
from app.services.pipeline import polish_bible_args, polish_outline_args

router = APIRouter(prefix="/api/novels", tags=["planning"])


def _novel_or_404(session: Session, novel_id: int):
    novel = novel_svc.get_novel(session, novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="小说不存在")
    return novel


def _recent_arc_context(session: Session, novel_id: int, before_number: int) -> str:
    rows = chapter_svc.list_chapters(session, novel_id)
    prev = [c for c in rows if (c.number or 0) < before_number and ((c.summary or c.content or "").strip())]
    prev = sorted(prev, key=lambda c: c.number or 0)[-3:]
    if not prev:
        return "（尚无近章摘要，按设定与主题起弧）"
    lines = []
    for c in prev:
        text = (c.summary or "").strip() or (c.content or "")[-200:]
        lines.append(f"- 第{c.number}章《{c.title or '未命名'}》：{text}")
    return "\n".join(lines)


def _resolve_arc_start(chapters, start: int) -> int:
    start = int(start or 0)
    if start > 0:
        return start
    max_num = max((c.number or 0 for c in chapters), default=0)
    with_content = [c for c in chapters if (c.content or "").strip()]
    if with_content:
        return max(c.number or 0 for c in with_content) + 1
    return max(max_num, 0) + 1 if max_num else 1


async def _run_season_plan(
    *,
    session: Session,
    novel,
    theme: str,
    chapter_count: int,
    start: int,
    instruction: str,
    thinking: bool,
    prev_theme: str = "",
    prev_hook: str = "",
    prev_next_preview: str = "",
    season_number: int = 1,
) -> dict:
    chapters = chapter_svc.list_chapters(session, novel.id or 0)
    try:
        planned = await ArcPlanAgent().run(
            novel,
            theme=theme,
            chapter_count=chapter_count,
            start_number=start,
            instruction=instruction,
            recent_context=_recent_arc_context(session, novel.id or 0, start),
            prev_theme=prev_theme,
            prev_hook=prev_hook,
            prev_next_preview=prev_next_preview,
            season_number=season_number,
            thinking=thinking,
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"剧集生成失败：{exc}") from exc

    vol = 1
    if chapters:
        near = next((c for c in chapters if c.number == start), None) or chapters[-1]
        vol = near.volume or 1
    result = plan_svc.apply_arc_plan(session, novel, planned, volume=vol)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "剧集写入失败")
    session.refresh(novel)
    return {
        **result,
        "novel": novel_svc.to_out(session, novel),
        "seasons": plan_svc.list_seasons(session, novel.id or 0),
    }


@router.post("/{novel_id}/outline")
async def generate_outline(novel_id: int, payload: OutlinePlanIn, session: Session = Depends(get_session)):
    novel = _novel_or_404(session, novel_id)
    try:
        result = await OutlineAgent().run(
            novel, chapter_count=payload.chapter_count, instruction=payload.instruction
        )
        result = await polish_outline_args(result, brief=novel_brief(novel))
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"大纲生成失败：{exc}") from exc
    volumes = plan_svc.apply_outline(session, novel, result)
    return {"ok": True, "volumes": volumes, "novel": novel_svc.to_out(session, novel)}


@router.get("/{novel_id}/seasons")
def list_seasons(novel_id: int, session: Session = Depends(get_session)):
    _novel_or_404(session, novel_id)
    return plan_svc.list_seasons(session, novel_id)


@router.post("/{novel_id}/arc")
async def generate_arc(novel_id: int, payload: ArcPlanIn, session: Session = Depends(get_session)):
    """按大事件主题生成一季剧集（目录 + 介绍 + 季末钩子 + 下一季预告）。"""
    novel = _novel_or_404(session, novel_id)
    chapters = chapter_svc.list_chapters(session, novel_id)
    start = _resolve_arc_start(chapters, payload.start_number)
    last = plan_svc.latest_season(session, novel_id)
    return await _run_season_plan(
        session=session,
        novel=novel,
        theme=payload.theme,
        chapter_count=payload.chapter_count,
        start=start,
        instruction=payload.instruction,
        thinking=bool(payload.thinking),
        prev_theme=(last.theme if last else ""),
        prev_hook=(last.season_hook if last else ""),
        prev_next_preview=(last.next_preview if last else ""),
        season_number=plan_svc.next_season_number(session, novel_id),
    )


@router.post("/{novel_id}/seasons/next")
async def generate_next_season(novel_id: int, payload: SeasonNextIn, session: Session = Depends(get_session)):
    """承接上一季钩子与预告，生成下一季。"""
    novel = _novel_or_404(session, novel_id)
    last = plan_svc.latest_season(session, novel_id)
    if not last:
        raise HTTPException(status_code=400, detail="还没有本季。请先用「生成大剧情」规划第一季。")
    theme = (payload.theme or "").strip() or (last.next_theme or "").strip()
    if not theme:
        raise HTTPException(status_code=400, detail="请填写下一季主题，或先让上一季留下 next_theme。")
    start = int(last.end_number or 0) + 1
    extra = (payload.instruction or "").strip()
    bridge = (
        f"必须承接第{last.number}季「{last.theme}」季末钩子：{last.season_hook or '（无）'}。"
        f"上一季预告：{last.next_preview or '（无）'}。"
    )
    instruction = f"{bridge}\n{extra}".strip()
    return await _run_season_plan(
        session=session,
        novel=novel,
        theme=theme,
        chapter_count=payload.chapter_count,
        start=start,
        instruction=instruction,
        thinking=bool(payload.thinking),
        prev_theme=last.theme or "",
        prev_hook=last.season_hook or "",
        prev_next_preview=last.next_preview or "",
        season_number=int(last.number or 1) + 1,
    )


def _volume_chapter_span(session: Session, novel, volume: int) -> tuple[int, int, list]:
    chapters = [c for c in chapter_svc.list_chapters(session, novel.id or 0) if int(c.volume or 1) == volume]
    volumes = parse_outline(novel.outline_json)
    vol_row = next((v for v in volumes if int(v.get("volume") or 0) == volume), None)
    outline_nums = []
    if vol_row:
        for ch in vol_row.get("chapters") or []:
            if isinstance(ch, dict) and int(ch.get("number") or 0) > 0:
                outline_nums.append(int(ch["number"]))
    nums = [int(c.number or 0) for c in chapters if int(c.number or 0) > 0] + outline_nums
    if not nums:
        raise HTTPException(status_code=400, detail="这一卷还没有章节，请先建章或同步大纲。")
    return min(nums), max(nums), chapters


def _chapter_digest(chapters, lo: int, hi: int) -> str:
    lines = []
    for c in sorted(chapters, key=lambda x: x.number or 0):
        n = int(c.number or 0)
        if n < lo or n > hi:
            continue
        has_body = bool((c.content or "").strip())
        brief = ((c.plot_brief or c.summary or "")).strip().replace("\n", " ")
        if len(brief) > 180:
            brief = brief[:180] + "…"
        flag = "已有正文" if has_body else "空章"
        lines.append(f"- 第{n}章《{c.title or '未命名'}》[{flag}]：{brief or '（无要点）'}")
    return "\n".join(lines) or "（无）"


@router.post("/{novel_id}/volumes/{volume}/plan")
async def plan_volume_seasons(
    novel_id: int,
    volume: int,
    payload: VolumePlanIn,
    session: Session = Depends(get_session),
):
    """先定本卷季数与主线，再按季重梳章节剧情要点（不覆盖已有正文）。"""
    novel = _novel_or_404(session, novel_id)
    volume = max(int(volume or 1), 1)
    start, end, vol_chapters = _volume_chapter_span(session, novel, volume)
    volumes = parse_outline(novel.outline_json)
    vol_row = next((v for v in volumes if int(v.get("volume") or 0) == volume), None) or {}
    written = [c for c in vol_chapters if (c.content or "").strip()]
    written_digest = _chapter_digest(written, start, end) if written else "（尚无正文）"
    extra = (payload.instruction or "").strip()
    default_extra = (
        "第1卷先把季定完再拆章。全国大比不是本卷下一季，不要写进本卷季表；"
        "已写章节若已跳进全国大比，按本卷节奏改回试炼/余波/势力线。"
    )
    instruction = extra or default_extra
    try:
        planned = await VolumeSeasonAgent().run(
            novel,
            volume=volume,
            volume_title=str(vol_row.get("title") or ""),
            volume_summary=str(vol_row.get("summary") or ""),
            start_number=start,
            end_number=end,
            written_digest=written_digest,
            instruction=instruction,
            thinking=bool(payload.thinking),
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"本卷季规划失败：{exc}") from exc

    seasons_in = planned.get("seasons") or []
    if not seasons_in:
        raise HTTPException(status_code=502, detail="本卷季规划没有产出有效季表")

    all_plots: list[dict] = []
    if payload.replot:
        for season in seasons_in:
            digest = _chapter_digest(vol_chapters, int(season["start_number"]), int(season["end_number"]))
            try:
                plots = await ChapterPlotAgent().run(
                    novel,
                    season=season,
                    chapters_digest=digest,
                    instruction=instruction,
                    thinking=bool(payload.thinking),
                )
            except DeepSeekError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=502, detail=f"第{season.get('number')}季拆章失败：{exc}") from exc
            season["chapters"] = plots
            all_plots.extend(plots)

    if all_plots:
        plan_svc.apply_chapter_plots(session, novel, all_plots, volume=volume, rewrite_titles=True)

    if planned.get("volume_arc"):
        volumes = parse_outline(novel.outline_json)
        for vol in volumes:
            if int(vol.get("volume") or 0) == volume:
                vol["summary"] = planned["volume_arc"]
                if planned.get("volume_title") and not str(vol.get("title") or "").strip():
                    vol["title"] = planned["volume_title"]
        plan_svc.apply_outline(session, novel, {"volumes": volumes})

    saved = plan_svc.replace_seasons_in_range(
        session,
        novel,
        seasons_in,
        start_number=start,
        end_number=end,
    )
    session.refresh(novel)
    return {
        "ok": True,
        "volume": volume,
        "volume_title": planned.get("volume_title") or str(vol_row.get("title") or ""),
        "volume_arc": planned.get("volume_arc") or "",
        "start_number": start,
        "end_number": end,
        "replot_count": len(all_plots),
        "seasons": [plan_svc.season_to_dict(s) for s in saved],
        "chapters": all_plots,
        "novel": novel_svc.to_out(session, novel),
    }


@router.post("/{novel_id}/bible")
async def generate_bible(novel_id: int, session: Session = Depends(get_session)):
    novel = _novel_or_404(session, novel_id)
    volumes = parse_outline(novel.outline_json)
    if not volumes:
        raise HTTPException(status_code=400, detail="请先生成大纲，再让 AI 补设定。")
    try:
        result = await BibleAgent().run(novel)
        result = await polish_bible_args(result, brief=novel_brief(novel))
    except DeepSeekError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"设定生成失败：{exc}") from exc
    created = plan_svc.sync_chapters(session, novel_id, volumes)
    counts = plan_svc.apply_bible(session, novel_id, result)
    novel.status = "planned"
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return {
        "ok": True,
        "chapters_synced": created,
        "created": counts,
        "novel": novel_svc.to_out(session, novel),
    }
