from __future__ import annotations

import json
from typing import Any


def parse_outline(raw: str | list | dict | None) -> list[dict[str, Any]]:
    data: Any = raw
    if isinstance(raw, str) or raw is None:
        try:
            data = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
    if isinstance(data, dict):
        data = data.get("volumes") or data.get("outline") or []
    if not isinstance(data, list):
        return []

    volumes: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        chapters_in = item.get("chapters")
        chapters: list[dict[str, Any]] = []
        if isinstance(chapters_in, list):
            for ch in chapters_in:
                if not isinstance(ch, dict):
                    continue
                chapters.append(
                    {
                        "number": int(ch.get("number") or 0),
                        "title": str(ch.get("title") or "").strip(),
                        "summary": str(ch.get("summary") or "").strip(),
                    }
                )
        volumes.append(
            {
                "volume": int(item.get("volume") or (len(volumes) + 1)),
                "title": str(item.get("title") or "").strip(),
                "summary": str(item.get("summary") or "").strip(),
                "chapters": chapters,
            }
        )
    return volumes


def flatten_chapters(volumes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    auto = 1
    for vol in volumes:
        chapters = vol.get("chapters") or []
        if not chapters:
            chapters = [{"number": auto, "title": vol.get("title") or "", "summary": vol.get("summary") or ""}]
        for ch in chapters:
            number = int(ch.get("number") or 0) or auto
            rows.append(
                {
                    "volume": int(vol.get("volume") or 1),
                    "number": number,
                    "title": ch.get("title") or f"第{number}章",
                    "summary": ch.get("summary") or "",
                }
            )
            auto = max(auto, number) + 1
    return rows


def beat_for_chapter(raw: str | None, number: int) -> str:
    for row in flatten_chapters(parse_outline(raw)):
        if row["number"] == number:
            title = row["title"]
            summary = row["summary"]
            if title and summary:
                return f"{title}：{summary}"
            return title or summary
    return ""


def dumps_outline(volumes: list[dict[str, Any]]) -> str:
    return json.dumps(volumes, ensure_ascii=False)


def format_volumes(volumes: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for vol in volumes:
        vol_no = vol.get("volume") or 1
        title = vol.get("title") or ""
        lines.append(f"第{vol_no}卷 {title}".strip())
        if vol.get("summary"):
            lines.append(str(vol["summary"]).strip())
        chapters = vol.get("chapters") or []
        if chapters:
            lines.append("")
        for ch in chapters:
            number = ch.get("number") or 0
            name = ch.get("title") or ""
            lines.append(f"第{number}章 {name}".strip())
            if ch.get("summary"):
                lines.append(str(ch["summary"]).strip())
            lines.append("")
        if not chapters:
            lines.append("")
    return "\n".join(lines).strip()


def looks_like_outline_payload(data: Any) -> bool:
    volumes = parse_outline(data)
    if not volumes:
        return False
    return any(v.get("chapters") or v.get("title") or v.get("summary") for v in volumes)


def reply_to_readable(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return raw
    if looks_like_outline_payload(raw):
        return format_volumes(parse_outline(raw))

    decoder = json.JSONDecoder()
    starts: list[int] = []
    for token in ("[{", '{"', "[", "{"):
        idx = raw.find(token)
        if idx >= 0:
            starts.append(idx)
    if not starts:
        return raw
    start = min(starts)
    try:
        data, consumed = decoder.raw_decode(raw[start:])
    except json.JSONDecodeError:
        return raw
    if not looks_like_outline_payload(data):
        return raw
    prefix = raw[:start]
    for noise in ("大纲 JSON：", "大纲JSON：", "大纲 JSON:", "大纲："):
        prefix = prefix.replace(noise, "")
    prefix = prefix.strip()
    suffix = raw[start + consumed :].strip()
    body = format_volumes(parse_outline(data))
    return "\n\n".join(part for part in (prefix, body, suffix) if part)
