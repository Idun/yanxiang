from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class NovelCreate(BaseModel):
    title: str
    description: str = ""
    genre: str = ""
    premise: str = ""
    world_bible: str = ""
    power_system: str = ""
    outline_json: str = "[]"


class NovelUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    genre: Optional[str] = None
    premise: Optional[str] = None
    world_bible: Optional[str] = None
    power_system: Optional[str] = None
    outline_json: Optional[str] = None
    cover_prompt: Optional[str] = None
    studio_step: Optional[str] = None
    status: Optional[str] = None


class NovelOut(BaseModel):
    id: int
    title: str
    description: str
    genre: str
    premise: str
    world_bible: str
    power_system: str = ""
    outline_json: str
    cover_path: str = ""
    cover_prompt: str = ""
    studio_step: str = "idea"
    pending_kind: str = ""
    has_pending: bool = False
    confirm_label: str = ""
    step_label: str = ""
    step_hint: str = ""
    next_hint: str = ""
    has_cover: bool = False
    status: str
    created_at: datetime
    updated_at: datetime
    chapter_count: int = 0
    word_count: int = 0

    model_config = {"from_attributes": True}


class ChatIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    field: Optional[str] = None  # naming/world/bible/outline/chapters/power
    thinking: bool = False


class ChatMessageOut(BaseModel):
    id: int
    novel_id: int
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BootstrapIn(BaseModel):
    premise: str = Field(min_length=1, max_length=2000)


class OutlinePlanIn(BaseModel):
    chapter_count: int = Field(default=30, ge=8, le=80)
    instruction: str = ""


class ArcPlanIn(BaseModel):
    """一季剧集：如「全国大比」拆成连续多章标题 + 剧情要点。"""

    theme: str = Field(min_length=1, max_length=80)
    chapter_count: int = Field(default=8, ge=3, le=30)
    start_number: int = Field(default=0, ge=0, le=500)
    instruction: str = Field(default="", max_length=4000)
    thinking: bool = False


class SeasonNextIn(BaseModel):
    """按上一季钩子生成下一季；theme 可空，默认用上一季预告主题。"""

    theme: str = Field(default="", max_length=80)
    chapter_count: int = Field(default=8, ge=3, le=30)
    instruction: str = Field(default="", max_length=4000)
    thinking: bool = False


class VolumePlanIn(BaseModel):
    """先规划一卷有几季、每季主线，再按季重梳已有章节剧情要点（不覆盖正文）。"""

    instruction: str = Field(default="", max_length=4000)
    thinking: bool = False
    replot: bool = True


class ChapterCreate(BaseModel):
    volume: int = 1
    number: Optional[int] = None
    title: str = ""
    content: str = ""
    plot_brief: str = ""


class ChapterUpdate(BaseModel):
    volume: Optional[int] = None
    number: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    summary: Optional[str] = None
    plot_brief: Optional[str] = None
    lock_status: Optional[str] = None
    status: Optional[str] = None
    tags_json: Optional[str] = None
    storyline_ids_json: Optional[str] = None


class ChapterOut(BaseModel):
    id: int
    novel_id: int
    volume: int
    number: int
    title: str
    content: str
    summary: str
    plot_brief: str = ""
    lock_status: str = "in_progress"
    status: str
    word_count: int
    tags_json: str
    storyline_ids_json: str
    generation_mode: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GenerateIn(BaseModel):
    mode: str = Field(pattern="^(lottery|plot)$")
    instruction: str = ""
    target_words: int = Field(default=3500, ge=400, le=8000)
    character_ids: list[int] = Field(default_factory=list)
    polish: bool = True
    apply_revise: bool = True
    threshold: float = Field(default=7.0, ge=0, le=10)
    # 写正文前先跑内容规划 Agent，拆慢节奏场景表
    plan: bool = True
    # DeepSeek 思考模式：内容规划 / 写作 / 过审链路启用
    thinking: bool = False


class CharacterCreate(BaseModel):
    name: str
    role: str = ""
    personality: str = ""
    background: str = ""
    abilities: str = ""
    status_text: str = ""
    appearance_notes: str = ""


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    personality: Optional[str] = None
    background: Optional[str] = None
    abilities: Optional[str] = None
    status_text: Optional[str] = None
    appearance_notes: Optional[str] = None


class CharacterOut(CharacterCreate):
    id: int
    novel_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RelationshipCreate(BaseModel):
    from_char_id: int
    to_char_id: int
    relation_type: str = ""
    description: str = ""


class RelationshipOut(RelationshipCreate):
    id: int
    novel_id: int

    model_config = {"from_attributes": True}


class ItemCreate(BaseModel):
    name: str
    description: str = ""
    owner: str = ""
    status_text: str = ""


class ItemOut(ItemCreate):
    id: int
    novel_id: int

    model_config = {"from_attributes": True}


class LocationCreate(BaseModel):
    name: str
    description: str = ""
    notes: str = ""


class LocationOut(LocationCreate):
    id: int
    novel_id: int

    model_config = {"from_attributes": True}


class EventCreate(BaseModel):
    name: str
    description: str = ""
    timeline: str = ""
    related_chapters: str = ""
    resolved: bool = False


class EventOut(EventCreate):
    id: int
    novel_id: int

    model_config = {"from_attributes": True}


class StorylineCreate(BaseModel):
    name: str
    type: str = "main"
    elements_json: str = "{}"


class StorylineOut(StorylineCreate):
    id: int
    novel_id: int

    model_config = {"from_attributes": True}


class SettingsOut(BaseModel):
    has_api_key: bool
    api_key_masked: str = ""
    deepseek_model: str
    deepseek_base_url: str


class SettingsUpdate(BaseModel):
    deepseek_api_key: Optional[str] = None
    deepseek_model: Optional[str] = None
    deepseek_base_url: Optional[str] = None


class ReviewOut(BaseModel):
    id: int
    chapter_id: int
    novel_id: int
    agent: str
    overall: float
    scores: dict
    issues: list
    suggestions: list
    comment: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CoherenceIn(BaseModel):
    start_number: int = Field(default=1, ge=1, le=500)
    end_number: int = Field(default=14, ge=1, le=500)
    thinking: bool = False


class PipelineIn(BaseModel):
    apply_revise: bool = True
    threshold: float = Field(default=7.0, ge=0, le=10)
    thinking: bool = False


class ReviseIn(BaseModel):
    """作者手动优化点；有 notes 时可直接按意见改写，不必先跑审查。"""

    notes: str = Field(default="", max_length=8000)
    content: str = Field(default="", max_length=50000)
    thinking: bool = False


class NovelReportOut(BaseModel):
    chapter_count: int
    reviewed_count: int
    averages: dict
    chapters: list
