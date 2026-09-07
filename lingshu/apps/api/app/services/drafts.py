from __future__ import annotations

import json
import re
from typing import Any

from app.models.entities import utcnow
from app.services.outline import parse_outline
from app.services.studio_steps import CONFIRM_LABEL

STEP_KIND = {
    "idea": "meta",
    "naming": "meta",
    "world": "meta",
    "power": "power",
    "bible": "bible",
    "outline": "outline",
    "chapters": "chapters",
}

_META_MAP = {
    "title": ("title", "书名", "name"),
    "genre": ("genre", "类型"),
    "description": ("description", "简介", "blurb", "梗概"),
    "cover_prompt": ("cover_prompt", "封面提示词", "封面"),
    "world_bible": ("world_bible", "世界观", "world"),
    "power_system": ("power_system", "修炼体系", "战力体系", "境界体系"),
}


def confirm_label_for(step: str, pending_kind: str = "") -> str:
    kind = pending_kind or STEP_KIND.get(step or "idea", "meta")
    return CONFIRM_LABEL.get(kind, "确认，写入左边")


def extract_json(text: str) -> Any | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fenced = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
    fenced = re.sub(r"\s*```$", "", fenced)
    for candidate in (raw, fenced):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    decoder = json.JSONDecoder()
    for idx, ch in enumerate(raw):
        if ch not in "{[":
            continue
        try:
            data, _ = decoder.raw_decode(raw[idx:])
            return data
        except json.JSONDecodeError:
            continue
    return None


def _pick(data: dict[str, Any], names: tuple[str, ...]) -> str:
    for name in names:
        value = data.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _unwrap(data: Any) -> dict[str, Any]:
    if isinstance(data, dict):
        for key in ("payload", "meta", "data", "result"):
            inner = data.get(key)
            if isinstance(inner, dict):
                return inner
        return data
    return {}


def parse_labeled_meta(text: str) -> dict[str, str]:
    pattern = r"(?:^|\n)\s*(书名|类型|简介|封面提示词|封面|世界观|修炼体系|战力体系|境界体系)\s*[：:]\s*"
    parts = re.split(pattern, text or "")
    if len(parts) < 3:
        return {}
    mapping = {
        "书名": "title",
        "类型": "genre",
        "简介": "description",
        "封面提示词": "cover_prompt",
        "封面": "cover_prompt",
        "世界观": "world_bible",
        "修炼体系": "power_system",
        "战力体系": "power_system",
        "境界体系": "power_system",
    }
    out: dict[str, str] = {}
    for i in range(1, len(parts), 2):
        key = mapping.get(parts[i].strip())
        value = parts[i + 1].strip() if i + 1 < len(parts) else ""
        value = re.sub(r"\n```[\s\S]*$", "", value).strip()
        if key and value:
            out[key] = value
    return out


def parse_meta(text: str) -> dict[str, str]:
    data = extract_json(text)
    out: dict[str, str] = {}
    if isinstance(data, dict):
        blob = _unwrap(data)
        for dest, names in _META_MAP.items():
            value = _pick(blob, names)
            if value:
                out[dest] = value
    if "title" not in out or "description" not in out:
        labeled = parse_labeled_meta(text)
        for key, value in labeled.items():
            out.setdefault(key, value)
    if out.get("title") and out.get("description"):
        return out
    return {}


def parse_bible(text: str) -> dict[str, Any]:
    data = extract_json(text)
    if isinstance(data, dict):
        blob = _unwrap(data)
        chars = blob.get("characters") or blob.get("角色") or []
        if isinstance(chars, list) and chars:
            return {
                "characters": chars,
                "relationships": blob.get("relationships") or blob.get("关系") or [],
                "locations": blob.get("locations") or blob.get("场景") or [],
                "items": blob.get("items") or blob.get("道具") or [],
                "events": blob.get("events") or blob.get("伏笔") or [],
            }
    people: list[dict[str, str]] = []
    for block in re.split(r"\n(?=[\-•]?\s*(?:主角|配角|对手|反派|角色)[：:])", text or ""):
        name_m = re.search(r"(?:主角|配角|对手|反派|角色)?[：:\s]*([^\n，,（(]{2,12})", block)
        if not name_m:
            continue
        role_m = re.search(r"(主角|配角|对手|反派)", block)
        people.append(
            {
                "name": name_m.group(1).strip(),
                "role": (role_m.group(1) if role_m else "配角"),
                "personality": block.strip()[:400],
                "background": "",
            }
        )
    if len(people) >= 2:
        return {"characters": people}
    return {}


def parse_volumes(text: str, keep_chapters: bool) -> dict[str, Any]:
    data = extract_json(text)
    volumes = parse_outline(data if data is not None else text)
    if not volumes:
        volumes = []
        for match in re.finditer(
            r"第\s*(\d+)\s*卷\s*([^\n]*)\n([\s\S]*?)(?=第\s*\d+\s*卷|\Z)",
            text or "",
        ):
            volumes.append(
                {
                    "volume": int(match.group(1)),
                    "title": match.group(2).strip(),
                    "summary": match.group(3).strip(),
                    "chapters": [],
                }
            )
    if not keep_chapters:
        for vol in volumes:
            vol["chapters"] = []
    if volumes:
        return {"volumes": volumes}
    return {}


def parse_power(text: str) -> dict[str, str]:
    from app.services.power_system import coerce_power_payload, normalize_power_system, parse_power_system

    data = extract_json(text)
    if isinstance(data, dict):
        coerced = coerce_power_payload(data)
        if coerced:
            return {"power_system": coerced}
        blob = _unwrap(data)
        value = _pick(blob, ("power_system", "修炼体系", "战力体系", "境界体系", "content"))
        if value:
            return {"power_system": normalize_power_system(value)}
        if parse_power_system(json.dumps(blob, ensure_ascii=False)):
            return {"power_system": normalize_power_system(json.dumps(blob, ensure_ascii=False))}
    labeled = parse_labeled_meta(text)
    if labeled.get("power_system"):
        return {"power_system": normalize_power_system(labeled["power_system"])}
    raw = (text or "").strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    if len(raw) >= 40:
        return {"power_system": normalize_power_system(raw)}
    return {}


def parse_draft(text: str, step: str) -> tuple[str, dict[str, Any]] | None:
    kind = STEP_KIND.get(step or "idea", "meta")
    if kind == "meta":
        payload = parse_meta(text)
    elif kind == "power":
        payload = parse_power(text)
    elif kind == "bible":
        payload = parse_bible(text)
    elif kind == "outline":
        payload = parse_volumes(text, keep_chapters=False)
    else:
        payload = parse_volumes(text, keep_chapters=True)
    if not payload:
        return None
    return kind, payload


def format_meta(payload: dict[str, str]) -> str:
    lines = []
    if payload.get("title"):
        lines.append(f"书名：{payload['title']}")
    if payload.get("genre"):
        lines.append(f"类型：{payload['genre']}")
    if payload.get("description"):
        lines.append(f"简介：\n{payload['description']}")
    if payload.get("cover_prompt"):
        lines.append(f"封面提示词：\n{payload['cover_prompt']}")
    if payload.get("world_bible"):
        lines.append(f"世界观：\n{payload['world_bible']}")
    if payload.get("power_system"):
        lines.append(f"修炼体系：\n{payload['power_system']}")
    return "\n\n".join(lines).strip()


def format_bible(payload: dict[str, Any]) -> str:
    lines: list[str] = []
    for item in payload.get("characters") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        role = str(item.get("role") or "角色").strip()
        lines.append(f"{role} {name}")
        for label, key in (
            ("身份", "background"),
            ("性格", "personality"),
            ("能力", "abilities"),
            ("关系", "status_text"),
        ):
            value = str(item.get(key) or "").strip()
            if value:
                lines.append(f"{label}：{value}")
        lines.append("")
    for rel in payload.get("relationships") or []:
        if not isinstance(rel, dict):
            continue
        a = str(rel.get("from_name") or "").strip()
        b = str(rel.get("to_name") or "").strip()
        if a and b:
            lines.append(f"{a} → {b}（{rel.get('relation_type') or '关系'}）")
    return "\n".join(lines).strip()


def looks_off_step(text: str, step: str) -> bool:
    raw = (text or "").strip()
    kind = STEP_KIND.get(step or "idea", "")
    if not raw:
        return True
    if kind == "bible":
        if parse_bible(raw):
            return False
        if extract_json(raw) is not None:
            return True
        if re.search(r"(书名|简介|大纲|章节)\s*[：:]", raw) and not re.search(r"主角|配角|对手", raw):
            return True
        return not re.search(r"主角|配角|角色", raw)
    if kind == "power":
        return len(raw) < 40
    if kind == "outline":
        return bool(re.search(r"第\s*\d+\s*章", raw)) and not bool(re.search(r"第\s*\d+\s*卷", raw))
    if kind == "meta":
        data = extract_json(raw)
        if isinstance(data, dict) and (data.get("volumes") or data.get("大纲") or data.get("chapters")):
            return True
        return False
    return False


def readable_reply(text: str, step: str = "") -> str:
    from app.services.outline import reply_to_readable

    kind = STEP_KIND.get(step or "idea", "")
    if kind == "bible":
        bible = parse_bible(text)
        return format_bible(bible) if bible else (text or "").strip()
    if kind == "power":
        power = parse_power(text)
        if power.get("power_system"):
            return f"修炼体系：\n{power['power_system']}"
        return (text or "").strip()
    if kind in ("outline", "chapters"):
        return reply_to_readable(text)
    meta = parse_meta(text)
    if meta.get("title") and meta.get("description"):
        extra = []
        raw = (text or "").strip()
        if not raw.startswith("{") and "书名" not in raw[:20]:
            prefix = raw.split("{", 1)[0].strip()
            if prefix and "```" not in prefix:
                extra.append(prefix)
        body = format_meta(meta)
        return "\n\n".join(part for part in (*extra, body) if part)
    return reply_to_readable(text)


def retry_hint(step: str) -> str:
    kind = STEP_KIND.get(step or "idea", "meta")
    if kind == "bible":
        return (
            "走题了。书名、简介、大纲已经确认并写在左边，不要再重复。"
            "现在只列男主一人：姓名、身份写男主、性格、背景。不要配角，不要对手。"
            "禁止 JSON，禁止书名，禁止大纲，禁止章节。"
            "必须调用 propose_draft，kind 只能是 bible，payload.characters 是只含男主的数组。"
            "然后再用中文排版给作者看。"
        )
    if kind == "power":
        return (
            "走题了。现在只要修炼/战力体系：从低到高列出等级名称、晋升条件、主角当前所处，以及对决时必须遵守的硬规则。"
            "不要书名简介，不要角色列表，不要大纲。"
            "必须调用 propose_draft，kind 只能是 power，payload.power_system 是全文。"
        )
    if kind == "outline":
        return "走题了。现在只要分卷结构，列出卷名和每卷主线。不要书名简介，不要拆成章节，不要 JSON。"
    if kind == "chapters":
        return "走题了。现在只要按已确认大纲拆章节目录。不要重写书名简介，不要 JSON。"
    return "走题了。现在只要书名和简介，不要大纲和章节，不要 JSON。"


def sanitize_history(history: list[dict[str, str]], step: str) -> list[dict[str, str]]:
    kind = STEP_KIND.get(step or "idea", "")
    if kind != "bible":
        return history[-40:]
    cleaned: list[dict[str, str]] = []
    for row in history[-40:]:
        content = row.get("content") or ""
        if row.get("role") == "assistant" and looks_off_step(content, "bible"):
            cleaned.append(
                {
                    "role": "assistant",
                    "content": "书名和简介已经给你看过，作者已确认写入左边。下一步只列角色，不再重复书名简介大纲。",
                }
            )
        else:
            cleaned.append(row)
    return cleaned


def stash_pending(session, novel, kind: str, payload: dict[str, Any]) -> None:
    if kind == "meta" and (novel.studio_step or "idea") == "idea":
        novel.studio_step = "naming"
    novel.pending_kind = kind
    novel.pending_json = json.dumps(payload, ensure_ascii=False)
    novel.updated_at = utcnow()
    session.add(novel)
    session.commit()
    session.refresh(novel)
