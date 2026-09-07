from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.models import Character, Event, Item, Location, Relationship, Season
from app.models.entities import utcnow
from app.services import chapters as chapter_svc
from app.services.outline import dumps_outline, flatten_chapters, parse_outline
from app.schemas import ChapterCreate


def apply_outline(session: Session, novel, payload: dict[str, Any]) -> list[dict[str, Any]]:
    volumes = parse_outline(payload.get("volumes") or payload.get("outline") or payload)
    novel.outline_json = dumps_outline(volumes)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return volumes


def sync_chapters(
    session: Session,
    novel_id: int,
    volumes: list[dict[str, Any]],
    *,
    force_plot_brief: bool = False,
    only_numbers: set[int] | None = None,
) -> int:
    existing = {c.number: c for c in chapter_svc.list_chapters(session, novel_id)}
    created = 0
    for row in flatten_chapters(volumes):
        num = int(row["number"] or 0)
        if only_numbers is not None and num not in only_numbers:
            continue
        found = existing.get(num)
        if found:
            if not (found.content or "").strip():
                old_title = (found.title or "").strip()
                default_title = f"第{row['number']}章"
                new_title = (row.get("title") or "").strip()
                if new_title and (not old_title or old_title == default_title or force_plot_brief):
                    found.title = new_title
                found.summary = row["summary"]
                if row["summary"] and (
                    force_plot_brief or not (getattr(found, "plot_brief", None) or "").strip()
                ):
                    found.plot_brief = row["summary"]
                found.volume = row["volume"]
                found.updated_at = utcnow()
                session.add(found)
            continue
        chapter_svc.create_chapter(
            session,
            novel_id,
            ChapterCreate(
                volume=row["volume"],
                number=row["number"],
                title=row["title"],
                content="",
                plot_brief=row["summary"] or "",
            ),
        )
        created += 1
        # create_chapter commits; refresh existing map after
        existing = {c.number: c for c in chapter_svc.list_chapters(session, novel_id)}
        found = existing.get(row["number"])
        if found and row["summary"]:
            found.summary = row["summary"]
            found.plot_brief = row["summary"]
            session.add(found)
            session.commit()
    return created


def apply_arc_plan(
    session: Session,
    novel,
    payload: dict[str, Any],
    *,
    volume: int = 1,
) -> dict[str, Any]:
    """把一季剧集 merge 进大纲/空章，并落 Season 记录。"""
    theme = str(payload.get("theme") or "").strip() or "大剧情"
    arc_summary = str(payload.get("arc_summary") or "").strip()
    intro = str(payload.get("intro") or "").strip()
    season_hook = str(payload.get("season_hook") or "").strip()
    next_theme = str(payload.get("next_theme") or "").strip()
    next_preview = str(payload.get("next_preview") or "").strip()
    rows = payload.get("chapters") or []
    if not isinstance(rows, list) or not rows:
        return {"ok": False, "error": "大剧情没有章节", "created": 0, "updated": 0, "chapters": []}

    cleaned: list[dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        num = int(raw.get("number") or 0)
        if num <= 0:
            continue
        cleaned.append(
            {
                "number": num,
                "title": str(raw.get("title") or "").strip(),
                "summary": str(raw.get("summary") or "").strip(),
            }
        )
    if not cleaned:
        return {"ok": False, "error": "大剧情章节无效", "created": 0, "updated": 0, "chapters": []}

    volumes = parse_outline(getattr(novel, "outline_json", None))
    if not volumes:
        volumes = [
            {
                "volume": max(int(volume or 1), 1),
                "title": theme,
                "summary": arc_summary or intro,
                "chapters": [],
            }
        ]

    index: dict[int, tuple[dict[str, Any], dict[str, Any]]] = {}
    for vol in volumes:
        chs = vol.get("chapters")
        if not isinstance(chs, list):
            vol["chapters"] = []
            chs = vol["chapters"]
        for ch in chs:
            if isinstance(ch, dict):
                n = int(ch.get("number") or 0)
                if n:
                    index[n] = (vol, ch)

    target_vol = volumes[-1]
    for vol, _ch in index.values():
        target_vol = vol
        break
    if theme and not (target_vol.get("title") or "").strip():
        target_vol["title"] = theme
    if (arc_summary or intro) and len((target_vol.get("summary") or "").strip()) < 40:
        target_vol["summary"] = arc_summary or intro

    for row in cleaned:
        num = row["number"]
        if num in index:
            _vol, ch = index[num]
            if row["title"]:
                ch["title"] = row["title"]
            if row["summary"]:
                ch["summary"] = row["summary"]
        else:
            if not isinstance(target_vol.get("chapters"), list):
                target_vol["chapters"] = []
            target_vol["chapters"].append(
                {
                    "number": num,
                    "title": row["title"] or f"第{num}章",
                    "summary": row["summary"],
                }
            )

    for vol in volumes:
        chs = vol.get("chapters")
        if isinstance(chs, list):
            vol["chapters"] = sorted(
                [c for c in chs if isinstance(c, dict)],
                key=lambda c: int(c.get("number") or 0),
            )

    apply_outline(session, novel, {"volumes": volumes})
    numbers = {row["number"] for row in cleaned}
    created = sync_chapters(
        session,
        novel.id or 0,
        volumes,
        force_plot_brief=True,
        only_numbers=numbers,
    )

    nums = sorted(numbers)
    span = f"{nums[0]}-{nums[-1]}" if nums else ""
    existing_ev = session.exec(
        select(Event).where(Event.novel_id == novel.id, Event.name == theme)
    ).first()
    desc = intro or arc_summary or f"「{theme}」跨第 {span} 章"
    if season_hook:
        desc = f"{desc}\n季末钩子：{season_hook}"
    if existing_ev:
        existing_ev.description = desc or existing_ev.description
        existing_ev.related_chapters = span
        existing_ev.timeline = existing_ev.timeline or "剧集"
        session.add(existing_ev)
    else:
        session.add(
            Event(
                novel_id=novel.id or 0,
                name=theme,
                description=desc,
                timeline="剧集",
                related_chapters=span,
                resolved=False,
            )
        )

    season_no = next_season_number(session, novel.id or 0)
    season = Season(
        novel_id=novel.id or 0,
        number=season_no,
        theme=theme,
        intro=intro,
        summary=arc_summary,
        season_hook=season_hook,
        next_theme=next_theme,
        next_preview=next_preview,
        start_number=nums[0] if nums else 1,
        end_number=nums[-1] if nums else 1,
        chapters_json=json.dumps(cleaned, ensure_ascii=False),
        updated_at=utcnow(),
    )
    session.add(season)
    session.commit()
    session.refresh(season)

    return {
        "ok": True,
        "theme": theme,
        "intro": intro,
        "arc_summary": arc_summary,
        "season_hook": season_hook,
        "next_theme": next_theme,
        "next_preview": next_preview,
        "created": created,
        "updated": len(cleaned),
        "chapters": cleaned,
        "start_number": nums[0] if nums else 1,
        "end_number": nums[-1] if nums else 1,
        "season": season_to_dict(season),
    }


def apply_chapter_plots(
    session: Session,
    novel,
    rows: list[dict[str, Any]],
    *,
    volume: int = 1,
    rewrite_titles: bool = True,
) -> dict[str, int]:
    """写回剧情要点/摘要；不改正文。已有正文的章也会更新要点（供作者按新规划改写）。"""
    if not rows:
        return {"updated": 0, "created": 0}
    volumes = parse_outline(getattr(novel, "outline_json", None))
    if not volumes:
        volumes = [{"volume": volume, "title": "", "summary": "", "chapters": []}]

    index: dict[int, tuple[dict[str, Any], dict[str, Any]]] = {}
    for vol in volumes:
        chs = vol.get("chapters")
        if not isinstance(chs, list):
            vol["chapters"] = []
            chs = vol["chapters"]
        for ch in chs:
            if isinstance(ch, dict):
                n = int(ch.get("number") or 0)
                if n:
                    index[n] = (vol, ch)

    target_vol = volumes[0]
    for vol in volumes:
        if int(vol.get("volume") or 0) == volume:
            target_vol = vol
            break

    cleaned: list[dict[str, Any]] = []
    for raw in rows:
        num = int(raw.get("number") or 0)
        if num <= 0:
            continue
        title = str(raw.get("title") or "").strip()
        summary = str(raw.get("summary") or "").strip()
        cleaned.append({"number": num, "title": title, "summary": summary})
        if num in index:
            _vol, ch = index[num]
            if title:
                ch["title"] = title
            if summary:
                ch["summary"] = summary
        else:
            if not isinstance(target_vol.get("chapters"), list):
                target_vol["chapters"] = []
            target_vol["chapters"].append({"number": num, "title": title or f"第{num}章", "summary": summary})

    for vol in volumes:
        chs = vol.get("chapters")
        if isinstance(chs, list):
            vol["chapters"] = sorted(
                [c for c in chs if isinstance(c, dict)],
                key=lambda c: int(c.get("number") or 0),
            )

    apply_outline(session, novel, {"volumes": volumes})

    existing = {c.number: c for c in chapter_svc.list_chapters(session, novel.id or 0)}
    updated = 0
    created = 0
    for row in cleaned:
        found = existing.get(row["number"])
        summary = row["summary"]
        title = row["title"]
        if not found:
            created_ch = chapter_svc.create_chapter(
                session,
                novel.id or 0,
                ChapterCreate(
                    volume=volume,
                    number=row["number"],
                    title=title or f"第{row['number']}章",
                    content="",
                    plot_brief=summary,
                ),
            )
            if summary:
                created_ch.summary = summary
                created_ch.plot_brief = summary
                session.add(created_ch)
                session.commit()
            created += 1
            existing = {c.number: c for c in chapter_svc.list_chapters(session, novel.id or 0)}
            continue
        if title and rewrite_titles:
            old = (found.title or "").strip()
            default = f"第{row['number']}章"
            if (not (found.content or "").strip()) or old in {default, "", "全国大比·续"} or old.endswith("·续"):
                found.title = title
            elif not (found.content or "").strip():
                found.title = title
        if summary:
            found.summary = summary
            found.plot_brief = summary
        found.volume = volume
        found.updated_at = utcnow()
        session.add(found)
        updated += 1
    session.commit()
    return {"updated": updated, "created": created}


def replace_seasons_in_range(
    session: Session,
    novel,
    seasons_payload: list[dict[str, Any]],
    *,
    start_number: int,
    end_number: int,
) -> list[Season]:
    """用新的本卷季表替换覆盖同一章号区间的旧季。"""
    novel_id = novel.id or 0
    old_rows = list(session.exec(select(Season).where(Season.novel_id == novel_id)).all())
    for row in old_rows:
        s0 = int(row.start_number or 0)
        s1 = int(row.end_number or 0)
        if s0 <= end_number and s1 >= start_number:
            session.delete(row)
    session.commit()

    created: list[Season] = []
    remaining = list(session.exec(select(Season).where(Season.novel_id == novel_id)).all())
    base = max([int(s.number or 0) for s in remaining], default=0)
    for idx, raw in enumerate(seasons_payload):
        start = int(raw.get("start_number") or 0)
        end = int(raw.get("end_number") or 0)
        if start <= 0 or end < start:
            continue
        theme = str(raw.get("theme") or "").strip() or f"第{idx + 1}季"
        intro = str(raw.get("intro") or "").strip()
        summary = str(raw.get("arc_summary") or raw.get("summary") or "").strip()
        hook = str(raw.get("season_hook") or "").strip()
        next_theme = str(raw.get("next_theme") or "").strip()
        next_preview = str(raw.get("next_preview") or "").strip()
        chs = raw.get("chapters") if isinstance(raw.get("chapters"), list) else []
        season = Season(
            novel_id=novel_id,
            number=base + idx + 1,
            theme=theme,
            intro=intro,
            summary=summary,
            season_hook=hook,
            next_theme=next_theme,
            next_preview=next_preview,
            start_number=start,
            end_number=end,
            chapters_json=json.dumps(chs, ensure_ascii=False),
            updated_at=utcnow(),
        )
        session.add(season)
        created.append(season)

        span = f"{start}-{end}"
        desc = intro or summary or theme
        if hook:
            desc = f"{desc}\n季末钩子：{hook}"
        existing_ev = session.exec(select(Event).where(Event.novel_id == novel_id, Event.name == theme)).first()
        if existing_ev:
            existing_ev.description = desc or existing_ev.description
            existing_ev.related_chapters = span
            existing_ev.timeline = existing_ev.timeline or "剧集"
            session.add(existing_ev)
        else:
            session.add(
                Event(
                    novel_id=novel_id,
                    name=theme,
                    description=desc,
                    timeline="剧集",
                    related_chapters=span,
                    resolved=False,
                )
            )

    # 清掉已被替换的「全国大比」旧事件（若本卷不再使用该主题）
    keep_names = {str(s.get("theme") or "").strip() for s in seasons_payload}
    stale = session.exec(select(Event).where(Event.novel_id == novel_id, Event.timeline == "剧集")).all()
    for ev in stale:
        if ev.name == "全国大比" and "全国大比" not in keep_names:
            session.delete(ev)

    session.commit()
    for season in created:
        session.refresh(season)

    # 重新编号为全书连续季号
    all_rows = list(session.exec(select(Season).where(Season.novel_id == novel_id).order_by(Season.start_number.asc())).all())
    for idx, row in enumerate(all_rows):
        row.number = idx + 1
        session.add(row)
    session.commit()
    return all_rows


def next_season_number(session: Session, novel_id: int) -> int:
    rows = session.exec(select(Season).where(Season.novel_id == novel_id)).all()
    if not rows:
        return 1
    return max(int(s.number or 0) for s in rows) + 1


def list_seasons(session: Session, novel_id: int) -> list[dict[str, Any]]:
    rows = session.exec(
        select(Season).where(Season.novel_id == novel_id).order_by(Season.number.asc())
    ).all()
    return [season_to_dict(s) for s in rows]


def latest_season(session: Session, novel_id: int) -> Season | None:
    rows = session.exec(
        select(Season).where(Season.novel_id == novel_id).order_by(Season.number.desc())
    ).all()
    return rows[0] if rows else None


def season_to_dict(season: Season) -> dict[str, Any]:
    chapters: list[Any] = []
    try:
        raw = json.loads(season.chapters_json or "[]")
        if isinstance(raw, list):
            chapters = raw
    except Exception:
        chapters = []
    return {
        "id": season.id,
        "novel_id": season.novel_id,
        "number": season.number,
        "theme": season.theme,
        "intro": season.intro,
        "summary": season.summary,
        "season_hook": season.season_hook,
        "next_theme": season.next_theme,
        "next_preview": season.next_preview,
        "start_number": season.start_number,
        "end_number": season.end_number,
        "chapters": chapters,
    }


def upsert_outline_chapter_summary(
    session: Session,
    novel,
    *,
    number: int,
    title: str = "",
    summary: str = "",
    volume: int = 1,
) -> None:
    """把作者修改的剧情要点写回 outline_json 对应章。"""
    summary = (summary or "").strip()
    title = (title or "").strip()
    if not summary and not title:
        return
    volumes = parse_outline(getattr(novel, "outline_json", None))
    if not volumes:
        volumes = [{"volume": volume or 1, "title": "", "summary": "", "chapters": []}]
    placed = False
    for vol in volumes:
        chapters = vol.get("chapters")
        if not isinstance(chapters, list):
            continue
        for ch in chapters:
            if int(ch.get("number") or 0) == number:
                if title:
                    ch["title"] = title
                if summary:
                    ch["summary"] = summary
                placed = True
                break
        if placed:
            break
    if not placed:
        target = volumes[-1]
        if not isinstance(target.get("chapters"), list):
            target["chapters"] = []
        target["chapters"].append(
            {"number": number, "title": title or f"第{number}章", "summary": summary}
        )
    novel.outline_json = dumps_outline(volumes)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)


def upsert_next_chapter_plan(
    session: Session,
    novel,
    *,
    current_number: int,
    current_volume: int = 1,
    title: str,
    summary: str,
    force_plot_brief: bool = False,
) -> dict[str, Any]:
    """生成本章时写入下一章标题与剧情要点，供下一章「剧情模式」指令框使用。"""
    title = (title or "").strip()
    summary = (summary or "").strip()
    if not title and not summary:
        return {"ok": False, "error": "empty"}
    next_number = max(int(current_number or 1), 1) + 1
    volume = max(int(current_volume or 1), 1)

    volumes = parse_outline(getattr(novel, "outline_json", None))
    if not volumes:
        volumes = [{"volume": volume, "title": "", "summary": "", "chapters": []}]

    placed = False
    for vol in volumes:
        chapters = vol.get("chapters")
        if not isinstance(chapters, list):
            chapters = []
            vol["chapters"] = chapters
        for ch in chapters:
            if int(ch.get("number") or 0) == next_number:
                if title:
                    ch["title"] = title
                if summary:
                    ch["summary"] = summary
                placed = True
                volume = int(vol.get("volume") or volume)
                break
        if placed:
            break
    if not placed:
        # 挂到含当前章的卷，否则最后一卷
        target = volumes[-1]
        for vol in volumes:
            nums = [int(c.get("number") or 0) for c in (vol.get("chapters") or []) if isinstance(c, dict)]
            if current_number in nums or (not nums and int(vol.get("volume") or 0) == volume):
                target = vol
                break
        if not isinstance(target.get("chapters"), list):
            target["chapters"] = []
        target["chapters"].append({"number": next_number, "title": title or f"第{next_number}章", "summary": summary})
        volume = int(target.get("volume") or volume)

    novel.outline_json = dumps_outline(volumes)
    novel.updated_at = utcnow()
    session.add(novel)

    existing = {c.number: c for c in chapter_svc.list_chapters(session, novel.id or 0)}
    found = existing.get(next_number)
    if found:
        has_body = bool((found.content or "").strip())
        if not has_body:
            old_title = (found.title or "").strip()
            default_title = f"第{next_number}章"
            placeholder = (
                not old_title
                or old_title == default_title
                or old_title.endswith("·续")
                or old_title in {"未命名", "待定"}
            )
            # 空章：有新标题且旧标题是占位时更新；强制刷新时也覆盖标题
            if title and (force_plot_brief or placeholder):
                found.title = title
            if summary:
                found.summary = summary
                if force_plot_brief or not (getattr(found, "plot_brief", None) or "").strip():
                    found.plot_brief = summary
            found.volume = volume
            found.updated_at = utcnow()
            session.add(found)
        elif force_plot_brief and summary:
            # 下一章已有正文：只刷新剧情要点备忘，不改正文
            found.plot_brief = summary
            found.updated_at = utcnow()
            session.add(found)
        elif summary and not (getattr(found, "plot_brief", None) or "").strip():
            found.plot_brief = summary
            found.updated_at = utcnow()
            session.add(found)
        elif summary and not (found.summary or "").strip():
            found.summary = summary
            found.updated_at = utcnow()
            session.add(found)
    else:
        created = chapter_svc.create_chapter(
            session,
            novel.id or 0,
            ChapterCreate(
                volume=volume,
                number=next_number,
                title=title or f"第{next_number}章",
                content="",
                plot_brief=summary,
            ),
        )
        if summary:
            created.summary = summary
            created.plot_brief = summary
            created.updated_at = utcnow()
            session.add(created)
            session.commit()
            session.refresh(created)

    session.commit()
    session.refresh(novel)
    return {
        "ok": True,
        "number": next_number,
        "title": title,
        "summary": summary,
        "volume": volume,
    }


def apply_bible(session: Session, novel_id: int, payload: dict[str, Any]) -> dict[str, int]:
    counts = {"characters": 0, "relationships": 0, "locations": 0, "items": 0, "events": 0}

    existing_chars = session.exec(select(Character).where(Character.novel_id == novel_id)).all()
    by_name = {c.name: c for c in existing_chars}
    for item in payload.get("characters") or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        fields = {
            "role": item.get("role") or "",
            "personality": item.get("personality") or "",
            "background": item.get("background") or "",
            "abilities": item.get("abilities") or "",
            "status_text": item.get("status_text") or "",
            "appearance_notes": item.get("appearance_notes") or "",
        }
        row = by_name.get(name)
        if row:
            for key, value in fields.items():
                setattr(row, key, value)
            row.updated_at = utcnow()
            session.add(row)
        else:
            row = Character(novel_id=novel_id, name=name, **fields)
            session.add(row)
            counts["characters"] += 1
        by_name[name] = row
    session.commit()

    # 立项角色步骤：只保留本次 payload 里的人（通常只有男主），清掉旧配角以免卡死剧情
    payload_names = {
        str(item.get("name") or "").strip()
        for item in (payload.get("characters") or [])
        if isinstance(item, dict) and str(item.get("name") or "").strip()
    }
    if payload_names:
        for stale in list(session.exec(select(Character).where(Character.novel_id == novel_id)).all()):
            if (stale.name or "").strip() in payload_names:
                continue
            for rel in session.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all():
                if rel.from_char_id == stale.id or rel.to_char_id == stale.id:
                    session.delete(rel)
            session.delete(stale)
        session.commit()

    chars = session.exec(select(Character).where(Character.novel_id == novel_id)).all()
    name_ids = {c.name: c.id for c in chars if c.id}

    old_rels = session.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all()
    for rel in old_rels:
        session.delete(rel)
    session.commit()

    for item in payload.get("relationships") or []:
        from_id = name_ids.get(str(item.get("from_name") or "").strip())
        to_id = name_ids.get(str(item.get("to_name") or "").strip())
        if not from_id or not to_id or from_id == to_id:
            continue
        session.add(
            Relationship(
                novel_id=novel_id,
                from_char_id=from_id,
                to_char_id=to_id,
                relation_type=item.get("relation_type") or "",
                description=item.get("description") or "",
            )
        )
        counts["relationships"] += 1

    def upsert_named(model, key: str, items: list, extra_map: dict[str, str]) -> None:
        existing = {row.name: row for row in session.exec(select(model).where(model.novel_id == novel_id)).all()}
        for item in items:
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            data = {field: item.get(src) or "" for field, src in extra_map.items()}
            row = existing.get(name)
            if row:
                for field, value in data.items():
                    setattr(row, field, value)
                session.add(row)
            else:
                session.add(model(novel_id=novel_id, name=name, **data))
                counts[key] += 1

    upsert_named(
        Location,
        "locations",
        payload.get("locations") or [],
        {"description": "description", "notes": "notes"},
    )
    upsert_named(
        Item,
        "items",
        payload.get("items") or [],
        {"description": "description", "owner": "owner", "status_text": "status_text"},
    )
    upsert_named(
        Event,
        "events",
        payload.get("events") or [],
        {"description": "description", "timeline": "timeline", "related_chapters": "related_chapters"},
    )
    session.commit()
    return counts


def upsert_relationships(session: Session, novel_id: int, items: list[dict[str, Any]]) -> int:
    """按 from_name/to_name 合并写入关系，不整表清空。"""
    chars = session.exec(select(Character).where(Character.novel_id == novel_id)).all()
    name_ids = {c.name: c.id for c in chars if c.id and c.name}
    existing = {
        (r.from_char_id, r.to_char_id): r
        for r in session.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all()
    }
    changed = 0
    for item in items or []:
        from_id = name_ids.get(str(item.get("from_name") or "").strip())
        to_id = name_ids.get(str(item.get("to_name") or "").strip())
        if not from_id or not to_id or from_id == to_id:
            continue
        key = (from_id, to_id)
        relation_type = str(item.get("relation_type") or "").strip()
        description = str(item.get("description") or "").strip()
        row = existing.get(key)
        if row:
            if relation_type:
                row.relation_type = relation_type
            if description:
                row.description = description
            session.add(row)
            changed += 1
        else:
            session.add(
                Relationship(
                    novel_id=novel_id,
                    from_char_id=from_id,
                    to_char_id=to_id,
                    relation_type=relation_type or "相关",
                    description=description,
                )
            )
            changed += 1
    session.commit()
    return changed


def upsert_new_characters(session: Session, novel_id: int, items: list[dict[str, Any]]) -> list[str]:
    """只追加正文里新出场的角色，不覆盖已有核心班底，也不清空关系。"""
    existing = {
        (c.name or "").strip(): c
        for c in session.exec(select(Character).where(Character.novel_id == novel_id)).all()
        if (c.name or "").strip()
    }
    created: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or name in existing:
            continue
        row = Character(
            novel_id=novel_id,
            name=name,
            role=str(item.get("role") or "配角").strip() or "配角",
            personality=str(item.get("personality") or "").strip(),
            background=str(item.get("background") or "").strip(),
            abilities=str(item.get("abilities") or "").strip(),
            status_text=str(item.get("status_text") or "").strip(),
            appearance_notes=str(item.get("appearance_notes") or "").strip(),
        )
        session.add(row)
        existing[name] = row
        created.append(name)
    if created:
        session.commit()
    return created


def prune_non_protagonist_characters(session: Session, novel_id: int) -> dict[str, Any]:
    """立项口径：角色表只留男主/主角，删掉其余人并清理相关关系；旧专名记入退场名单并 scrub 设定摘要。"""
    from app.models import Novel
    from app.services.cast_scrub import merge_retired_names, scrub_novel_narratives
    from app.services.context import is_protagonist

    novel = session.get(Novel, novel_id)
    if not novel:
        return {"ok": False, "error": "小说不存在", "kept": [], "removed": [], "removed_count": 0}

    chars = list(session.exec(select(Character).where(Character.novel_id == novel_id)).all())
    leads = [c for c in chars if is_protagonist(c)]
    if not leads and len(chars) == 1:
        leads = chars
    keep_ids = {c.id for c in leads if c.id}
    keep_names = {((c.name or "").strip()) for c in leads if (c.name or "").strip()}
    removed: list[str] = []
    for c in chars:
        if c.id in keep_ids:
            continue
        removed.append(c.name or f"#{c.id}")
        session.delete(c)
    if removed:
        for rel in session.exec(select(Relationship).where(Relationship.novel_id == novel_id)).all():
            if rel.from_char_id not in keep_ids or rel.to_char_id not in keep_ids:
                session.delete(rel)
        session.commit()

    # 去掉括号备注名：「林父（林国栋）」→ 同时收「林父」「林国栋」
    scrub_names: list[str] = []
    for raw in removed:
        name = (raw or "").strip()
        if not name or name in keep_names:
            continue
        scrub_names.append(name)
        if "（" in name and name.endswith("）"):
            base, _, rest = name.partition("（")
            inner = rest[:-1].strip()
            if base.strip():
                scrub_names.append(base.strip())
            if inner:
                scrub_names.append(inner)
        elif "(" in name and name.endswith(")"):
            base, _, rest = name.partition("(")
            inner = rest[:-1].strip()
            if base.strip():
                scrub_names.append(base.strip())
            if inner:
                scrub_names.append(inner)

    scrub_names = [n for n in scrub_names if n and n not in keep_names]
    retired = merge_retired_names(novel, scrub_names)
    scrub_info = scrub_novel_narratives(session, novel, retired)
    keep_list = [c.name for c in leads if c.name]
    return {
        "ok": True,
        "kept": keep_list,
        "removed": removed,
        "removed_count": len(removed),
        "retired": retired,
        "scrubbed": scrub_info,
    }


def apply_pending(session: Session, novel, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.studio_steps import CONFIRM_NEXT

    kind = (kind or "").strip()
    payload = payload if isinstance(payload, dict) else {}
    next_step = CONFIRM_NEXT.get(novel.studio_step or "idea", "writing")

    if kind == "meta":
        for key in ("title", "genre", "description", "cover_prompt", "world_bible", "premise", "power_system"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                if key == "premise":
                    existing = (novel.premise or "").strip()
                    if existing and len(existing) >= 80 and len(value.strip()) < len(existing):
                        continue
                if key == "power_system":
                    from app.services.power_system import normalize_power_system

                    setattr(novel, key, normalize_power_system(value))
                else:
                    setattr(novel, key, value.strip())
        next_step = "bible"
    elif kind == "power":
        from app.services.power_system import coerce_power_payload

        value = coerce_power_payload(payload)
        if value:
            novel.power_system = value
        next_step = novel.studio_step or "writing"
    elif kind == "bible":
        apply_bible(session, novel.id or 0, payload)
        next_step = "outline"
    elif kind == "outline":
        volumes = parse_outline(payload.get("volumes") or payload)
        for vol in volumes:
            vol["chapters"] = []
        apply_outline(session, novel, {"volumes": volumes})
        next_step = "chapters"
    elif kind == "chapters":
        volumes = apply_outline(session, novel, payload)
        sync_chapters(session, novel.id or 0, volumes)
        next_step = "writing"
    else:
        return {"ok": False, "error": f"未知草稿类型 {kind}"}

    novel.studio_step = next_step
    novel.pending_kind = ""
    novel.pending_json = ""
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)
    return {"ok": True, "kind": kind, "step": next_step}
