from pathlib import Path

from app.llm.deepseek import chat_json, chat_stream, chat_text, default_model
from app.services.context import WritingContext, word_count

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"


def _read_prompt(name: str) -> str:
    return (PROMPTS / name).read_text(encoding="utf-8").strip()


class WritingAgent:
    name = "writing"

    def __init__(self) -> None:
        self.system_prompt = _read_prompt("writing_agent.md")
        self.summary_prompt = _read_prompt("summary_agent.md")

    async def stream(self, ctx: WritingContext, *, thinking: bool = False, on_reasoning=None):
        from app.services.context import ContextAssembler

        user = ContextAssembler().to_user_prompt(ctx)
        async for token in chat_stream(
            system=self.system_prompt,
            user=user,
            temperature=0.9,
            thinking=thinking,
            on_reasoning=on_reasoning,
        ):
            yield token

    async def summarize(self, content: str) -> str:
        if not content.strip():
            return ""
        return await chat_text(
            system=self.summary_prompt,
            user=content[-4000:],
            temperature=0.3,
        )


class BootstrapAgent:
    name = "bootstrap"

    def __init__(self) -> None:
        self.system_prompt = _read_prompt("bootstrap_agent.md")

    async def run(self, premise: str) -> dict:
        data = await chat_json(
            system=self.system_prompt,
            user=f"灵感：{premise}",
            temperature=0.8,
        )
        outline = data.get("outline") or []
        import json

        return {
            "title": data.get("title") or "未命名小说",
            "description": data.get("description") or "",
            "genre": data.get("genre") or "",
            "premise": premise,
            "world_bible": data.get("world_bible") or "",
            "outline_json": json.dumps(outline, ensure_ascii=False),
            "model": default_model(),
        }


def count_words(text: str) -> int:
    return word_count(text)
