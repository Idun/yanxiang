"""已退场配角脱敏：剪枝后不再把旧专名灌进写章上下文与大纲摘要。"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlmodel import Session, select

from app.models import Chapter, Novel


PLACEHOLDER = "某人"


def parse_retired_names(novel: Any) -> list[str]:
    raw = getattr(novel, "retired_cast_json", None) or "[]"
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    names = [str(x).strip() for x in data if str(x).strip()]
    # 长名优先替换，避免「林」误伤
    return sorted(set(names), key=len, reverse=True)


def merge_retired_names(novel: Any, names: list[str]) -> list[str]:
    merged = parse_retired_names(novel)
    for n in names:
        n = (n or "").strip()
        if not n:
            continue
        if n not in merged:
            merged.append(n)
    merged = sorted(set(merged), key=len, reverse=True)
    novel.retired_cast_json = json.dumps(merged, ensure_ascii=False)
    return merged


def scrub_text(text: str, names: list[str], *, placeholder: str = PLACEHOLDER) -> str:
    if not text or not names:
        return text or ""
    out = text
    for name in sorted({n.strip() for n in names if n and n.strip()}, key=len, reverse=True):
        if len(name) < 2:
            continue
        out = out.replace(name, placeholder)
    # 压缩连续「某人某人」
    out = re.sub(rf"(?:{re.escape(placeholder)}){{2,}}", placeholder, out)
    return out


def scrub_novel_narratives(session: Session, novel: Novel, names: list[str]) -> dict[str, Any]:
    """把退场专名从设定/摘要/剧情要点中抹掉（正文仅在注入写章时脱敏，不改库内正文）。"""
    if not names:
        return {"ok": True, "fields": 0, "chapters": 0}

    touched = 0
    for field in ("description", "premise", "world_bible", "outline_json", "power_system"):
        old = getattr(novel, field, None) or ""
        new = scrub_text(old, names)
        if new != old:
            setattr(novel, field, new)
            touched += 1

    ch_touched = 0
    chapters = session.exec(select(Chapter).where(Chapter.novel_id == novel.id)).all()
    for ch in chapters:
        changed = False
        for field in ("summary", "plot_brief", "title"):
            old = getattr(ch, field, None) or ""
            new = scrub_text(old, names)
            if new != old:
                setattr(ch, field, new)
                changed = True
        if changed:
            session.add(ch)
            ch_touched += 1

    session.add(novel)
    session.commit()
    session.refresh(novel)
    return {"ok": True, "fields": touched, "chapters": ch_touched, "names": names}


def redact_for_prompt(text: str, novel: Any) -> str:
    return scrub_text(text or "", parse_retired_names(novel))
