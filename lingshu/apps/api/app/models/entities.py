from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Novel(SQLModel, table=True):
    __tablename__ = "novels"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    genre: str = ""
    premise: str = ""
    world_bible: str = ""
    power_system: str = ""
    outline_json: str = "[]"
    # 已从角色表清掉的配角专名；写章注入摘要/章末时脱敏，避免模型强制续写旧班底
    retired_cast_json: str = "[]"
    cover_path: str = ""
    cover_prompt: str = ""
    studio_step: str = "idea"
    pending_kind: str = ""
    pending_json: str = ""
    status: str = "draft"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Chapter(SQLModel, table=True):
    __tablename__ = "chapters"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    volume: int = 1
    number: int = 1
    title: str = ""
    content: str = ""
    summary: str = ""
    # 剧情模式指令 / 本章要点（作者可改可存；与生成后摘要 summary 分开）
    plot_brief: str = ""
    # in_progress=可编辑；locked=已定稿只读
    lock_status: str = "in_progress"
    status: str = "draft"
    word_count: int = 0
    tags_json: str = "[]"
    storyline_ids_json: str = "[]"
    generation_mode: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Character(SQLModel, table=True):
    __tablename__ = "characters"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    name: str
    role: str = ""
    personality: str = ""
    background: str = ""
    abilities: str = ""
    status_text: str = ""
    appearance_notes: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Relationship(SQLModel, table=True):
    __tablename__ = "relationships"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    from_char_id: int = Field(foreign_key="characters.id")
    to_char_id: int = Field(foreign_key="characters.id")
    relation_type: str = ""
    description: str = ""


class Item(SQLModel, table=True):
    __tablename__ = "items"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    name: str
    description: str = ""
    owner: str = ""
    status_text: str = ""


class Location(SQLModel, table=True):
    __tablename__ = "locations"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    name: str
    description: str = ""
    notes: str = ""


class Event(SQLModel, table=True):
    __tablename__ = "events"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    name: str
    description: str = ""
    timeline: str = ""
    related_chapters: str = ""
    resolved: bool = False


class Season(SQLModel, table=True):
    """一大事件 = 一季剧集：介绍、章目录、季末钩子、下一季预告。"""

    __tablename__ = "seasons"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    number: int = 1
    theme: str = ""
    intro: str = ""
    summary: str = ""
    season_hook: str = ""
    next_theme: str = ""
    next_preview: str = ""
    start_number: int = 1
    end_number: int = 1
    chapters_json: str = "[]"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Storyline(SQLModel, table=True):
    __tablename__ = "storylines"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    name: str
    type: str = "main"
    elements_json: str = "{}"


class Review(SQLModel, table=True):
    __tablename__ = "reviews"

    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_id: int = Field(foreign_key="chapters.id", index=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    agent: str
    overall: float = 0
    scores_json: str = "{}"
    issues_json: str = "[]"
    suggestions_json: str = "[]"
    comment: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class GenerationRun(SQLModel, table=True):
    __tablename__ = "generation_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_id: Optional[int] = Field(default=None, foreign_key="chapters.id", index=True)
    novel_id: Optional[int] = Field(default=None, foreign_key="novels.id", index=True)
    agent: str
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_ms: int = 0
    finish_reason: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    novel_id: int = Field(foreign_key="novels.id", index=True)
    role: str
    content: str = ""
    created_at: datetime = Field(default_factory=utcnow)
