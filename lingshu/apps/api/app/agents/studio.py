from __future__ import annotations

import copy
import inspect
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from app.llm.deepseek import (
    DeepSeekError,
    apply_thinking,
    assistant_message_dict,
    default_model,
    emit_reasoning,
    get_client,
    reasoning_of,
)
from app.models import Novel
from app.services.context import power_system_block
from app.services.drafts import STEP_KIND, looks_off_step, retry_hint, sanitize_history
from app.services.outline import format_volumes, parse_outline
from app.services.studio_steps import STEP_IDS, step_info

OnTool = Callable[[str, dict[str, Any]], dict[str, Any] | Awaitable[dict[str, Any]]]

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "propose_draft",
            "description": "把本步草稿暂存，等作者点确认后再写入左边。kind 必须等于当前步骤：书名简介=meta，角色=bible，分卷=outline，拆章=chapters，修炼体系=power。不要在作者确认前 save。",
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["meta", "bible", "outline", "chapters", "power"]},
                    "payload": {"type": "object"},
                },
                "required": ["kind", "payload"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_meta",
            "description": "把作者已确认的书名、类型、简介、封面提示词或世界观写入左边资料库。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "genre": {"type": "string"},
                    "description": {"type": "string"},
                    "premise": {"type": "string"},
                    "cover_prompt": {"type": "string"},
                    "world_bible": {"type": "string"},
                    "power_system": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_outline",
            "description": "仅在作者已确认大纲、当前步骤为列大纲时写入。禁止在说想法/定书名时调用。不要把 JSON 写进对话。",
            "parameters": {
                "type": "object",
                "properties": {
                    "volumes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "volume": {"type": "integer"},
                                "title": {"type": "string"},
                                "summary": {"type": "string"},
                                "chapters": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "number": {"type": "integer"},
                                            "title": {"type": "string"},
                                            "summary": {"type": "string"},
                                        },
                                    },
                                },
                            },
                        },
                    }
                },
                "required": ["volumes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_bible",
            "description": "写入角色、关系、场景、道具、伏笔。",
            "parameters": {
                "type": "object",
                "properties": {
                    "characters": {"type": "array", "items": {"type": "object"}},
                    "relationships": {"type": "array", "items": {"type": "object"}},
                    "locations": {"type": "array", "items": {"type": "object"}},
                    "items": {"type": "array", "items": {"type": "object"}},
                    "events": {"type": "array", "items": {"type": "object"}},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_step",
            "description": "把当前创作步骤推到下一步。仅在作者认可本步成果后调用。",
            "parameters": {
                "type": "object",
                "properties": {"step": {"type": "string", "enum": STEP_IDS}},
                "required": ["step"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter",
            "description": "写指定章节并自动跑写作→审查→去AI味→必要时改写→读者。禁止把整章正文写进对话。",
            "parameters": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer", "description": "章号，从 1 开始"},
                    "instruction": {"type": "string", "description": "本章额外指令，可空，默认用大纲要点"},
                    "mode": {"type": "string", "enum": ["plot", "lottery"]},
                    "target_words": {"type": "integer"},
                },
                "required": ["number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repolish_chapter",
            "description": "对已有章节再跑审查→去AI味→改写→读者。作者说不满意、再优化、重写润色时调用。可反复执行。",
            "parameters": {
                "type": "object",
                "properties": {
                    "number": {
                        "type": "integer",
                        "description": "章号；不传则优化最近一章有正文的章节",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repolish_saved",
            "description": "对左边已保存的书名简介/世界观、大纲或设定再跑审查链并写回。作者对已写入内容说不满意时调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "enum": ["meta", "outline", "bible", "power"]},
                },
                "required": ["target"],
            },
        },
    },
]


def studio_tools(step: str) -> list[dict[str, Any]]:
    tools = copy.deepcopy(TOOLS)
    expected = STEP_KIND.get(step or "idea")
    filtered: list[dict[str, Any]] = []
    for item in tools:
        name = item.get("function", {}).get("name")
        if (step or "idea") in STEP_KIND and name in ("write_chapter", "repolish_chapter"):
            continue
        if expected and name == "propose_draft":
            item["function"]["parameters"]["properties"]["kind"] = {
                "type": "string",
                "enum": [expected],
            }
            item["function"]["description"] = (
                f"暂存当前步骤草稿。当前只能 kind={expected}，payload 必须是这一步的内容。"
                "角色步骤 payload 要有 characters 数组；禁止再传书名简介大纲。"
            )
        filtered.append(item)
    return filtered


STEP_LOCK = {
    "idea": "【本回合锁定】只给书名和简介。不要大纲，不要章节，不要 JSON。",
    "naming": "【本回合锁定】只给书名和简介。不要大纲，不要章节，不要 JSON。",
    "world": "【本回合锁定】只补世界观设定，须与左边书名简介角色大纲连贯。不要重写书名简介，不要大纲，不要章节。",
    "power": "【本回合锁定】只写修炼/战力体系，必须返回 JSON：intro、stages、hard_rules。stages 每项含 stage、realms、level、core、promotion、notes。不要 Python 字典单引号，不要书名简介，不要角色列表，不要大纲。",
    "bible": "【本回合锁定】只列男主一人。禁止书名、类型、简介、大纲、章节、配角、对手、JSON。propose_draft 只能 kind=bible，characters 只含男主。",
    "outline": "【本回合锁定】只列分卷结构。不要书名简介，不要细章，不要 JSON。",
    "chapters": "【本回合锁定】只拆章节目录。不要重写书名简介，不要 JSON。",
}


def _system(novel: Novel, chapter_brief: str = "", user_text: str = "", character_brief: str = "") -> str:
    info = step_info(novel.studio_step or "idea")
    step_id = novel.studio_step or "idea"
    outline = parse_outline(novel.outline_json)
    if step_id in ("idea", "naming", "world", "bible", "power"):
        outline_block = "（当前还没到大纲，忽略左边旧大纲）"
    elif step_id == "outline":
        vols = [{**v, "chapters": []} for v in outline]
        outline_block = format_volumes(vols) if vols else "未写"
    else:
        outline_block = format_volumes(outline) if outline else "未写"
    snapshot = f"""书名：{novel.title}
类型：{novel.genre or '未定'}
简介：{novel.description or '未写'}
封面提示词：{novel.cover_prompt or '未写'}
灵感：{novel.premise or '未写'}
世界观：
{novel.world_bible or '未写'}
{power_system_block(novel)}
已确认角色：
{character_brief or '还没有角色'}
大纲：
{outline_block}
已有章节：
{chapter_brief or '还没有章节正文'}
"""
    body = (PROMPTS / "studio_agent.md").read_text(encoding="utf-8").strip()
    from app.agents.workshop import author_lock

    lock = author_lock(user_text, novel.premise or "")
    return f"""{body}

{lock}

当前步骤：{info['label']}
{STEP_LOCK.get(step_id, '')}
页面提示：{info['hint']}
完成后下一步：{info['next']}

左边已保存资料（生成/优化时必须当作记忆沿用，保持全书连贯；与作者原话冲突时，以作者原话为准）：
{snapshot}
"""


async def run_studio_turn(
    novel: Novel,
    history: list[dict[str, str]],
    user_text: str,
    on_tool: OnTool,
    chapter_brief: str = "",
    character_brief: str = "",
    thinking: bool = False,
    on_reasoning: Callable[[str], Any] | None = None,
) -> str:
    client = get_client()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system(novel, chapter_brief, user_text, character_brief)}
    ]
    messages.extend(sanitize_history(history, novel.studio_step or "idea"))
    messages.append({"role": "user", "content": user_text})

    step_id = novel.studio_step or "idea"
    tools = studio_tools(step_id)
    retries = 0
    for round_i in range(10):
        kwargs: dict[str, Any] = {
            "model": default_model(),
            "temperature": 0.55,
            "tools": tools,
            "messages": messages,
        }
        kwargs = apply_thinking(kwargs, thinking=thinking)
        if round_i == 0 and step_id in STEP_KIND:
            kwargs["tool_choice"] = {"type": "function", "function": {"name": "propose_draft"}}
        resp = await client.chat.completions.create(**kwargs)
        choice = resp.choices[0]
        msg = choice.message
        if thinking:
            await emit_reasoning(on_reasoning, reasoning_of(msg))
        tool_calls = msg.tool_calls or []
        if not tool_calls:
            text = (msg.content or "").strip()
            if step_id in STEP_KIND and looks_off_step(text, step_id) and retries < 2:
                retries += 1
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": retry_hint(step_id)})
                continue
            return text
        messages.append(assistant_message_dict(msg, thinking=thinking))
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = on_tool(tc.function.name, args if isinstance(args, dict) else {})
            if inspect.isawaitable(result):
                result = await result
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
    raise DeepSeekError("这一轮工具调用过多，请再发一条消息继续。")
