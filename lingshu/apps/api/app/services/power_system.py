from __future__ import annotations

import ast
import json
import re
from typing import Any

_FENCE = re.compile(r"^```(?:json|python|py)?\s*", re.I)
_LABEL = re.compile(r"^(?:修炼体系|战力体系|境界体系)\s*[：:]\s*")


def strip_power_text(raw: str) -> str:
    text = (raw or "").strip()
    text = _FENCE.sub("", text)
    text = re.sub(r"\s*```$", "", text)
    text = _LABEL.sub("", text)
    return text.strip()


def _extract_object(raw: str) -> str:
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    return raw


def _loads(text: str) -> Any | None:
    for candidate in (text, _extract_object(text)):
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        try:
            return ast.literal_eval(candidate)
        except (ValueError, SyntaxError, MemoryError):
            pass
    return None


def _unwrap(data: Any, depth: int = 0) -> dict[str, Any] | None:
    if depth > 3:
        return None
    if isinstance(data, str):
        nested = _loads(strip_power_text(data))
        return _unwrap(nested, depth + 1) if nested is not None else None
    if not isinstance(data, dict):
        return None
    for key in ("power_system", "payload", "data", "result", "修炼体系", "战力体系"):
        inner = data.get(key)
        if inner is None:
            continue
        opened = _unwrap(inner, depth + 1)
        if opened and (opened.get("intro") or opened.get("stages") or opened.get("hard_rules")):
            return opened
    return data


def parse_power_system(raw: str) -> dict[str, Any] | None:
    text = strip_power_text(raw)
    if not text:
        return None
    blob = _unwrap(_loads(text))
    if not blob:
        return None
    intro = str(blob.get("intro") or blob.get("概述") or blob.get("总览") or "").strip()
    stages_raw = blob.get("stages") or blob.get("篇章") or []
    stages: list[dict[str, Any]] = []
    if isinstance(stages_raw, list):
        for item in stages_raw:
            if not isinstance(item, dict):
                continue
            realms = item.get("realms") or item.get("境界") or []
            if isinstance(realms, str):
                realms = [part.strip() for part in re.split(r"[\n；;]+", realms) if part.strip()]
            elif not isinstance(realms, list):
                realms = []
            stages.append(
                {
                    "stage": str(item.get("stage") or item.get("name") or item.get("title") or "").strip(),
                    "realms": [str(x).strip() for x in realms if str(x).strip()],
                    "level": str(item.get("level") or item.get("战力层级") or "").strip(),
                    "core": str(item.get("core") or item.get("核心") or "").strip(),
                    "promotion": str(item.get("promotion") or item.get("晋升") or "").strip(),
                    "notes": str(item.get("notes") or item.get("备注") or "").strip(),
                }
            )
    rules = blob.get("hard_rules") or blob.get("rules") or blob.get("硬规则") or []
    if isinstance(rules, str):
        rules = [part.strip() for part in re.split(r"[\n；;]+", rules) if part.strip()]
    elif not isinstance(rules, list):
        rules = []
    rules = [str(item).strip() for item in rules if str(item).strip()]
    if not intro and not stages and not rules:
        return None
    return {"intro": intro, "stages": stages, "hard_rules": rules}


def normalize_power_system(raw: str) -> str:
    parsed = parse_power_system(raw)
    if not parsed:
        return (raw or "").strip()
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def coerce_power_payload(draft: dict[str, Any] | None) -> str:
    data = draft if isinstance(draft, dict) else {}
    value = data.get("power_system") or data.get("content")
    if isinstance(value, dict):
        return normalize_power_system(json.dumps(value, ensure_ascii=False))
    if isinstance(value, str) and value.strip():
        return normalize_power_system(value)
    if data.get("intro") is not None or data.get("stages") or data.get("hard_rules"):
        return normalize_power_system(
            json.dumps(
                {
                    "intro": data.get("intro") or "",
                    "stages": data.get("stages") or [],
                    "hard_rules": data.get("hard_rules") or [],
                },
                ensure_ascii=False,
            )
        )
    return ""


def format_power_system(raw: str, *, missing: str = "（未填）") -> str:
    text = (raw or "").strip()
    if not text:
        return missing
    parsed = parse_power_system(text)
    if not parsed:
        return text
    lines: list[str] = []
    if parsed.get("intro"):
        lines.append(str(parsed["intro"]))
    for stage in parsed.get("stages") or []:
        title = stage.get("stage") or "篇章"
        level = stage.get("level") or ""
        realms = "、".join(stage.get("realms") or [])
        head = f"【{title}】{level}".strip()
        if realms:
            head += f"｜境界：{realms}"
        lines.append(head)
        if stage.get("core"):
            lines.append(f"核心：{stage['core']}")
        if stage.get("promotion"):
            lines.append(str(stage["promotion"]))
        if stage.get("notes"):
            lines.append(f"备注：{stage['notes']}")
    rules = parsed.get("hard_rules") or []
    if rules:
        lines.append("硬规则：")
        lines.extend(f"- {rule}" for rule in rules)
    return "\n".join(line for line in lines if line).strip() or text


def list_realms(raw: str) -> list[str]:
    parsed = parse_power_system(raw)
    if not parsed:
        return []
    seen: set[str] = set()
    chain: list[str] = []

    def add(name: str) -> None:
        item = (name or "").strip()
        if not item or item in seen:
            return
        seen.add(item)
        chain.append(item)

    intro = str(parsed.get("intro") or "")
    match = re.search(r"「([^」]+)」", intro)
    if match:
        for part in re.split(r"[—–\-→＞>]", match.group(1)):
            add(part)
    for stage in parsed.get("stages") or []:
        for realm in stage.get("realms") or []:
            add(str(realm))
    return chain


def realm_lock_block(raw: str) -> str:
    realms = list_realms(raw)
    if not realms:
        return (
            "【修炼体系硬锁定】左边还没有完整境界表。写修炼时不要另起通用仙侠等级"
            "（禁止筑基、金丹、元婴、练气、先天、后天等）。"
        )
    names = "、".join(realms)
    return f"""【修炼体系硬锁定｜必须逐字遵守，优先级等同作者原话】
允许出现的境界/等级只有：{names}
- 禁止使用上表没有的任何修炼等级、战力称谓、境界别名（包括但不限于筑基、结丹、金丹、元婴、化神、练气、开光、辟谷、先天、后天、超凡、入圣）。
- 可以说「某某境前期/中期/后期/巅峰」，但大境界名称必须来自上表。
- 原文若写了表外等级，改写时必须改回上表对应境界，不得沿用错的。
- 旁白点评、配角自报、系统面板同样只能用上表，禁止自造一套。"""
