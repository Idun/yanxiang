from __future__ import annotations

STEPS: list[dict[str, str]] = [
    {
        "id": "idea",
        "label": "说想法",
        "hint": "现在：把故事大概讲给我听。我会按你的主角和世界来写，不会另编一套。",
        "next": "说完后我会给你书名和简介。觉得可以就点确认，写入左边作品信息。",
        "suggest": "我想写一个……",
    },
    {
        "id": "naming",
        "label": "书名简介",
        "hint": "现在：看右边的书名、类型、简介。可以就点确认，写入作品信息；不行就说再出几个。",
        "next": "确认后根据这些作品信息生成角色，再让你确认。",
        "suggest": "",
    },
    {
        "id": "world",
        "label": "世界观",
        "hint": "现在：补一句世界观也可以，或直接确认作品信息，下一步出角色。",
        "next": "确认后根据作品信息生成角色。",
        "suggest": "",
    },
    {
        "id": "bible",
        "label": "角色",
        "hint": "现在：角色是按已确认的作品信息来的。可以就点确认创建；不行就让我改。",
        "next": "角色确认后，下一步只列分卷结构，先不拆章。",
        "suggest": "",
    },
    {
        "id": "power",
        "label": "修炼体系",
        "hint": "现在：补全从低到高的等级、晋升条件和主角当前境界。写章时会始终带上这份设定。",
        "next": "确认后写入修炼体系，后续对话都会遵守这套战力规则。",
        "suggest": "",
    },
    {
        "id": "outline",
        "label": "结构大纲",
        "hint": "现在：只看分卷和大块主线，不用一章一章列。可以就点确认。",
        "next": "结构确认后，再按卷拆成章节目录。",
        "suggest": "",
    },
    {
        "id": "chapters",
        "label": "拆章",
        "hint": "现在：按已确认的大纲结构拆章节。可以就点确认，生成章节目录。",
        "next": "目录确认后就可以写第一章。",
        "suggest": "",
    },
    {
        "id": "writing",
        "label": "写章",
        "hint": "现在：可以说「写第一章」。正文会先过写作、审查、去 AI 味、读者，再给你看。",
        "next": "不满意就说再优化；满意了可以预览或写下一章。",
        "suggest": "写第一章",
    },
    {
        "id": "polish",
        "label": "审查润色",
        "hint": "现在：觉得不合适就说再优化。",
        "next": "满意了就预览；要继续就写下一章。",
        "suggest": "再优化这一章",
    },
    {
        "id": "preview",
        "label": "预览",
        "hint": "现在：用手机阅读框看成品。",
        "next": "可以返回继续写下一章。",
        "suggest": "打开预览",
    },
]

STEP_IDS = [s["id"] for s in STEPS]

CONFIRM_NEXT = {
    "idea": "naming",
    "naming": "bible",
    "world": "bible",
    "bible": "outline",
    "outline": "chapters",
    "chapters": "writing",
}

NEXT_PROMPT = {
    "naming": "请根据我刚说的想法，给出书名和简介。",
    "bible": "书名简介已经确认写在左边。现在只列出男主一人：姓名、身份、性格、背景。不要配角，不要对手，不要书名，不要简介，不要大纲，不要 JSON。",
    "outline": "请根据已确认的作品信息和角色，列出分卷结构，不要拆细章。",
    "chapters": "请根据已确认的大纲，拆成章节目录。",
}

CONFIRM_LABEL = {
    "meta": "确认，写入作品信息",
    "bible": "确认，创建角色",
    "power": "确认，写入修炼体系",
    "outline": "确认，写入结构大纲",
    "chapters": "确认，生成章节目录",
}

WELCOME = (
    "把你的想法告诉我就行。\n\n"
    "我会先给你书名和简介，你觉得可以就点确认，写入左边作品信息。\n"
    "然后按这些信息给你角色，再确认后才创建。\n"
    "大纲先只列分卷结构，细章等结构定了再拆。\n\n"
    "对话可以随时删。生成内容都会先过审；不满意就说再优化。"
)

# 按字段打开 AI 弹窗时的引导语（field 与 studio_step 对齐）
FIELD_WELCOME = {
    "idea": (
        "先在下方写清想法或修改要求，再点发送。"
        "我会结合当前作品资料给出书名和简介；满意就点确认写入。"
    ),
    "naming": (
        "下方已预填生成提示，可先改成你的要求（比如想要的调性、主角设定），再点发送。"
        "生成后还可继续提修改意见；点确认才会写入。"
    ),
    "world": (
        "下方已预填生成提示，可先补充你想强调的世界观要点，再点发送。"
        "我会参考书名、简介、角色与大纲；点确认才会写入。"
    ),
    "bible": (
        "下方已预填生成提示，可先说明角色偏好或必出现的人物，再点发送。"
        "我会参考已确认的作品信息；点确认才会创建角色。"
    ),
    "power": (
        "下方已预填生成提示，可先写清你要的等级名称、晋升门槛或禁区，再点发送。"
        "写章、改写、字段 AI 都会带上这份修炼体系，以保持战力一致；点确认才会写入。"
    ),
    "outline": (
        "下方已预填生成提示，可先写卷数、主线偏好等要求，再点发送。"
        "我会参考作品信息与角色；点确认才会写入大纲。"
    ),
    "chapters": (
        "下方已预填生成提示，可先写拆章密度或重点情节要求，再点发送。"
        "我会参考已确认的分卷大纲；点确认才会生成章节。"
    ),
}

FIELD_PROMPTS = {
    "idea": "请根据我的想法，结合当前作品资料，给出书名和简介。",
    "naming": "请根据作者灵感与当前作品全部已有资料，给出书名、类型、简介和封面提示词，保持与已有设定连贯。",
    "world": "请根据当前书名、简介、角色与大纲，补全世界观，保持与已有内容连贯。不要重写书名简介。",
    "bible": "请根据已确认的作品信息（书名、简介、世界观），只列出男主一人。不要书名，不要简介，不要大纲，不要配角列表。",
    "power": "请根据书名、简介、世界观和角色，整理一套修炼/战力体系。必须只返回 JSON（双引号），字段为 intro、stages（stage/realms/level/core/promotion/notes）、hard_rules。从低到高写清等级、晋升条件、主角当前所处。不要 Python 字典，不要书名简介，不要角色列表，不要大纲。",
    "outline": "请根据已确认的作品信息与角色，列出分卷结构，不要拆细章。保持主线连贯。",
    "chapters": "请根据已确认的大纲结构，拆成章节目录，保持与卷纲和角色设定连贯。",
}

FIELD_OPTIMIZE = {
    "idea": "请基于当前已有书名简介做分析优化，保留核心设定，不要另起一套。",
    "naming": "请基于当前已有书名简介做分析优化，保留核心设定，不要另起一套。",
    "world": "请基于当前已有世界观做分析优化，在原设定上完善，不要推翻重写。",
    "bible": "请基于当前已有角色做分析优化，在原人设上打磨，不要整批换人。",
    "power": "请基于当前已有修炼/战力体系做分析优化，补全缺口、消掉矛盾，仍返回 intro/stages/hard_rules 的 JSON。不要另起一套等级名称，不要 Python 字典。",
    "outline": "请基于当前已有分卷大纲做分析优化，在原卷纲上调整，不要另起主线。",
    "chapters": "请基于当前已有章节目录做分析优化，在原目录上调整，保持与分卷大纲连贯。",
}


def field_welcome(field: str | None) -> str:
    key = (field or "").strip()
    return FIELD_WELCOME.get(key) or WELCOME


def normalize_field(field: str | None) -> str | None:
    key = (field or "").strip()
    if key in FIELD_WELCOME:
        return key
    return None


def step_info(step_id: str) -> dict[str, str]:
    for item in STEPS:
        if item["id"] == step_id:
            return item
    return STEPS[0]


def is_confirm(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped or len(stripped) > 24:
        return False
    exact = {"确认", "就这样", "就用这个", "可以", "好", "好的", "行", "用这个", "确认写入", "写入左边"}
    return stripped in exact or stripped.startswith("确认")
