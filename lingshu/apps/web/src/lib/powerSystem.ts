export interface PowerStage {
  stage: string
  realms: string[]
  level: string
  core: string
  promotion: string
  notes: string
}

export interface PowerSystem {
  intro: string
  stages: PowerStage[]
  hard_rules: string[]
}

export interface LabeledLine {
  title: string
  body: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean)
  const text = asText(value)
  if (!text) return []
  return text
    .split(/\n+|；|;/)
    .map((item) => item.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
}

function stripFence(raw: string): string {
  let text = (raw || '').trim()
  text = text.replace(/^[“”"']+/, '').replace(/[“”"']+$/, '')
  text = text.replace(/^```(?:json|python|py)?\s*/i, '')
  text = text.replace(/\s*```$/, '')
  text = text.replace(/^(?:修炼体系|战力体系|境界体系)\s*[：:]\s*/, '')
  return text.trim()
}

function extractObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw
}

function pythonishToJson(raw: string): string {
  const src = raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/＇/g, "'")
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"') {
      const quote = c
      i += 1
      let chunk = ''
      while (i < src.length) {
        const ch = src[i]
        if (ch === '\\' && i + 1 < src.length) {
          const next = src[i + 1]
          if (next === '\n') {
            chunk += '\\n'
            i += 2
            continue
          }
          chunk += ch + next
          i += 2
          continue
        }
        if (ch === quote) {
          i += 1
          break
        }
        if (ch === '"') {
          chunk += '\\"'
          i += 1
          continue
        }
        if (ch === '\n') {
          chunk += '\\n'
          i += 1
          continue
        }
        if (ch === '\r') {
          chunk += '\\r'
          i += 1
          continue
        }
        if (ch === '\t') {
          chunk += '\\t'
          i += 1
          continue
        }
        chunk += ch
        i += 1
      }
      out += `"${chunk}"`
      continue
    }
    if (src.startsWith('None', i) && !/[A-Za-z0-9_]/.test(src[i + 4] || '')) {
      out += 'null'
      i += 4
      continue
    }
    if (src.startsWith('True', i) && !/[A-Za-z0-9_]/.test(src[i + 4] || '')) {
      out += 'true'
      i += 4
      continue
    }
    if (src.startsWith('False', i) && !/[A-Za-z0-9_]/.test(src[i + 5] || '')) {
      out += 'false'
      i += 5
      continue
    }
    out += c
    i += 1
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

function tryParseObject(raw: string): unknown {
  const candidates = [raw, pythonishToJson(raw)]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* next */
    }
  }
  return null
}

function unwrap(data: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3) return null
  if (typeof data === 'string') {
    const nested = tryParseObject(extractObject(stripFence(data)))
    return nested ? unwrap(nested, depth + 1) : null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const blob = data as Record<string, unknown>
  for (const key of ['power_system', 'payload', 'data', 'result', '修炼体系', '战力体系']) {
    const inner = blob[key]
    if (inner == null) continue
    const opened = unwrap(inner, depth + 1)
    if (opened && (opened.intro || opened.stages || opened.hard_rules || opened.概述)) return opened
  }
  return blob
}

function toStages(raw: unknown): PowerStage[] {
  if (!Array.isArray(raw)) return []
  const stages: PowerStage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const stage = asText(row.stage || row.name || row.title)
    const realms = asList(row.realms || row.境界)
    if (!stage && !realms.length) continue
    stages.push({
      stage: stage || `第${stages.length + 1}篇`,
      realms,
      level: asText(row.level || row.战力层级),
      core: asText(row.core || row.核心),
      promotion: asText(row.promotion || row.晋升),
      notes: asText(row.notes || row.备注),
    })
  }
  return stages
}

export function parsePowerSystem(raw: string): PowerSystem | null {
  const text = stripFence(raw)
  if (!text) return null
  const loaded = tryParseObject(text) || tryParseObject(extractObject(text))
  const blob = unwrap(loaded)
  if (!blob) return null
  const stages = toStages(blob.stages || blob.篇章 || blob.realms)
  const intro = asText(blob.intro || blob.概述 || blob.总览)
  const rules = asList(blob.hard_rules || blob.rules || blob.硬规则)
  if (!intro && !stages.length && !rules.length) return null
  return { intro, stages, hard_rules: rules }
}

export function stringifyPowerSystem(data: PowerSystem): string {
  return JSON.stringify(
    {
      intro: data.intro,
      stages: data.stages,
      hard_rules: data.hard_rules,
    },
    null,
    2,
  )
}

export function extractRealmChain(data: PowerSystem): string[] {
  const fromIntro = data.intro.match(/「([^」]+)」/)
  if (fromIntro) {
    const parts = fromIntro[1]
      .split(/[—–\-→＞>]/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (parts.length >= 3) return parts
  }
  const seen = new Set<string>()
  const chain: string[] = []
  for (const stage of data.stages) {
    for (const realm of stage.realms) {
      if (seen.has(realm)) continue
      seen.add(realm)
      chain.push(realm)
    }
  }
  return chain
}

export function splitLabeled(text: string, maxTitle = 16): LabeledLine {
  const match = text.trim().match(new RegExp(`^([^：:]{1,${maxTitle}})[：:]\\s*([\\s\\S]+)$`))
  if (match) return { title: match[1].trim(), body: match[2].trim() }
  return { title: '', body: text.trim() }
}

export function splitPromotion(text: string): LabeledLine[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => splitLabeled(line, 12))
}

export function extractProtagonistStatus(data: PowerSystem): LabeledLine | null {
  for (const rule of data.hard_rules) {
    const row = splitLabeled(rule)
    if (/主角/.test(row.title) || /主角/.test(rule)) {
      return { title: row.title || '主角当前境界', body: row.body || rule }
    }
  }
  return null
}
