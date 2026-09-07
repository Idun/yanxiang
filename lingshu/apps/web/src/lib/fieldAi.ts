import { parseOutline } from './outline'
import type { Character, NamedItem, Novel, Relationship } from '../types'

/** 与后端 studio_step / FIELD_* 对齐 */
export type AiField = 'naming' | 'world' | 'bible' | 'power' | 'outline' | 'chapters'

export interface FieldAiConfig {
  field: AiField
  title: string
  hint: string
  generatePrompt: string
  optimizePrompt: string
  /** 判断该字段是否已有内容，有则优先走「再优化」 */
  hasContent: (ctx: FieldContext) => boolean
}

export interface FieldContext {
  novel: Novel
  characterCount: number
  hasOutlineStructure: boolean
  hasChapterBreakdown: boolean
  characters?: Character[]
  relationships?: Relationship[]
  locations?: NamedItem[]
  events?: NamedItem[]
}

export const FIELD_AI: Record<AiField, FieldAiConfig> = {
  naming: {
    field: 'naming',
    title: 'AI · 书名与简介',
    hint: '已有内容时，提交会按现有书名简介做分析优化，而不是推倒重来。',
    generatePrompt:
      '请根据作者灵感与当前作品全部已有资料，给出书名、类型、简介和封面提示词，保持与已有设定连贯。',
    optimizePrompt:
      '请分析下方「当前已有内容」，指出可改进点并给出优化后的书名、类型、简介与封面提示词。在原有基础上打磨，不要另起一套故事。',
    hasContent: ({ novel }) =>
      Boolean(novel.description?.trim()) ||
      Boolean(novel.title?.trim() && novel.title.trim() !== '未命名作品' && novel.title.trim() !== '未命名'),
  },
  world: {
    field: 'world',
    title: 'AI · 世界观',
    hint: '已有内容时，提交会按现有世界观做分析优化。',
    generatePrompt:
      '请根据当前书名、简介、角色与大纲，补全世界观，保持与已有内容连贯。不要重写书名简介。',
    optimizePrompt:
      '请分析下方「当前已有内容」的世界观，指出漏洞或可加强处，并给出优化后的世界观全文。在原有设定上完善，不要推翻重写。',
    hasContent: ({ novel }) => Boolean(novel.world_bible?.trim()),
  },
  bible: {
    field: 'bible',
    title: 'AI · 角色',
    hint: '已有角色时，提交会按现有人设做分析优化。',
    generatePrompt:
      '请根据已确认的作品信息（书名、简介、世界观），只列出男主一人：姓名、身份写「男主」、性格、背景。不要配角、不要对手、不要书名简介大纲。其余角色会在章节锁定后从正文识别。',
    optimizePrompt:
      '请分析下方「当前已有内容」的男主设定，指出可加强处并给出优化后的男主一人。不要整批加人；配角对手不要在立项阶段列出。',
    hasContent: ({ characterCount }) => characterCount > 0,
  },
  power: {
    field: 'power',
    title: 'AI · 修炼体系',
    hint: '已有体系时，提交会按现有等级做分析优化。',
    generatePrompt:
      '请根据书名、简介、世界观和角色，整理一套修炼/战力体系。必须只返回 JSON（双引号），结构为 {"intro":"总览","stages":[{"stage":"篇章名","realms":["境界1"],"level":"战力层级","core":"核心变化","promotion":"各境晋升条件，可用换行","notes":"本篇备注"}],"hard_rules":["硬规则"]}。从低到高写清等级、晋升条件、主角当前所处。不要 Python 字典，不要书名简介，不要角色列表。',
    optimizePrompt:
      '请分析下方「当前已有内容」的修炼/战力体系，指出缺口或前后矛盾，并给出优化后的 JSON（结构与原来一致：intro / stages / hard_rules）。在原等级名称上完善，不要另起一套，不要用 Python 字典。',
    hasContent: ({ novel }) => Boolean(novel.power_system?.trim()),
  },
  outline: {
    field: 'outline',
    title: 'AI · 结构大纲',
    hint: '已有大纲时，提交会按现有分卷结构做分析优化。',
    generatePrompt:
      '请根据已确认的作品信息与角色，列出分卷结构，不要拆细章。保持主线连贯。',
    optimizePrompt:
      '请分析下方「当前已有内容」的分卷大纲，指出节奏或主线问题，并给出优化后的分卷结构（仍不要拆细章）。在原有卷纲上调整，不要另起主线。',
    hasContent: ({ hasOutlineStructure }) => hasOutlineStructure,
  },
  chapters: {
    field: 'chapters',
    title: 'AI · 章节目录',
    hint: '已有章节目录时，提交会按现有目录做分析优化。',
    generatePrompt:
      '请根据已确认的大纲结构，拆成章节目录，保持与卷纲和角色设定连贯。',
    optimizePrompt:
      '请分析下方「当前已有内容」的章节目录，指出可改进点，并给出优化后的章节目录。在原有目录上调整，保持与分卷大纲连贯。',
    hasContent: ({ hasChapterBreakdown }) => hasChapterBreakdown,
  },
}

/** 抽出当前字段已有正文，供优化时作为分析对象 */
export function fieldSnapshot(field: AiField, ctx: FieldContext): string {
  const { novel } = ctx
  if (field === 'naming') {
    return [
      `书名：${novel.title || '未定'}`,
      `类型：${novel.genre || '未定'}`,
      `简介：\n${novel.description || '未写'}`,
      `封面提示词：\n${novel.cover_prompt || '未写'}`,
      `灵感：\n${novel.premise || '未写'}`,
    ].join('\n')
  }
  if (field === 'world') {
    return novel.world_bible?.trim() || '未写'
  }
  if (field === 'bible') {
    const chars = ctx.characters || []
    if (!chars.length) return '还没有角色'
    const lines = chars.map(
      (c) =>
        `${c.name}（${c.role || '角色'}）\n性格：${c.personality || '—'}\n背景：${c.background || '—'}\n能力：${c.abilities || '—'}`,
    )
    const rels = (ctx.relationships || []).map(
      (r) => `关系：#${r.from_char_id} → #${r.to_char_id}（${r.relation_type}）${r.description || ''}`,
    )
    return [...lines, ...rels].join('\n\n')
  }
  if (field === 'power') {
    return novel.power_system?.trim() || '未写'
  }
  const volumes = parseOutline(novel.outline_json || '[]')
  if (field === 'outline') {
    if (!volumes.length) return '未写'
    return volumes
      .map((vol) => `第${vol.volume}卷 ${vol.title}\n${vol.summary || ''}`)
      .join('\n\n')
  }
  // chapters
  if (!volumes.length) return '未写'
  return volumes
    .map((vol) => {
      const chs = (vol.chapters || [])
        .map((ch) => `第${ch.number}章 ${ch.title}${ch.summary ? `：${ch.summary}` : ''}`)
        .join('\n')
      return `第${vol.volume}卷 ${vol.title}\n${chs || '（尚未拆章）'}`
    })
    .join('\n\n')
}

/** 组装发给模型的用户消息：用户要求 + 当前字段原文 */
export function buildSendPayload(
  field: AiField,
  userText: string,
  ctx: FieldContext,
  optimize: boolean,
): string {
  const text = userText.trim()
  if (!optimize) return text
  const snap = fieldSnapshot(field, ctx).trim()
  if (!snap || snap === '未写' || snap === '还没有角色') return text
  return `${text}

【当前已有内容｜请在此基础上分析并优化，保留核心设定，不要另起一套】
${snap}`
}
