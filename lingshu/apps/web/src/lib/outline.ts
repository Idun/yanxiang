import type { OutlineVolume, Season } from '../types'

export function parseOutline(raw: string | unknown): OutlineVolume[] {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw || '[]')
    } catch {
      return []
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as { volumes?: unknown; outline?: unknown }
    data = obj.volumes || obj.outline || []
  }
  if (!Array.isArray(data)) return []
  return data
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => {
      const chaptersIn = Array.isArray(item.chapters) ? item.chapters : []
      const chapters = chaptersIn
        .filter((ch): ch is Record<string, unknown> => !!ch && typeof ch === 'object')
        .map((ch) => ({
          number: Number(ch.number) || 0,
          title: String(ch.title || ''),
          summary: String(ch.summary || ''),
        }))
      return {
        volume: Number(item.volume) || index + 1,
        title: String(item.title || ''),
        summary: String(item.summary || ''),
        chapters,
      }
    })
}

export function outlineChapterCount(volumes: OutlineVolume[]) {
  const nested = volumes.reduce((sum, vol) => sum + vol.chapters.length, 0)
  return nested || volumes.length
}

/** 卷内章节号范围（不展开章标题） */
export function volumeChapterSpan(vol: OutlineVolume): { start: number; end: number; count: number } | null {
  const nums = vol.chapters.map((c) => c.number).filter((n) => n > 0)
  if (!nums.length) return null
  return {
    start: Math.min(...nums),
    end: Math.max(...nums),
    count: nums.length,
  }
}

export function formatChapterSpan(start: number, end: number): string {
  if (!start && !end) return ''
  if (!end || start === end) return `第${start}章`
  return `第${start}–${end}章`
}

/** 避免标题里已有「第N卷」时再拼一次 */
export function volumeHeading(volume: number, title: string): string {
  const vol = Math.max(Number(volume) || 1, 1)
  let t = (title || '').trim()
  t = t.replace(new RegExp(`^第\\s*${vol}\\s*卷\\s*`), '')
  t = t.replace(/^第\s*\d+\s*卷\s*/, '')
  return t ? `第${vol}卷 ${t}` : `第${vol}卷`
}

/** 按章节号范围把季挂到对应卷下；大纲页只展示卷/季，不列章 */
export function seasonsInVolume(seasons: Season[], vol: OutlineVolume): Season[] {
  const span = volumeChapterSpan(vol)
  if (!span) return []
  return seasons
    .filter((s) => {
      const start = Number(s.start_number) || 0
      const end = Number(s.end_number) || start
      if (!start) return false
      return start <= span.end && end >= span.start
    })
    .slice()
    .sort((a, b) => a.number - b.number)
}

export function orphanSeasons(seasons: Season[], volumes: OutlineVolume[]): Season[] {
  const attached = new Set(
    volumes.flatMap((vol) => seasonsInVolume(seasons, vol).map((s) => s.id)),
  )
  return seasons.filter((s) => !attached.has(s.id)).sort((a, b) => a.number - b.number)
}

export function chapterBeat(raw: string, number: number): string {
  let auto = 1
  for (const vol of parseOutline(raw)) {
    const chapters = vol.chapters.length
      ? vol.chapters
      : [{ number: auto, title: vol.title, summary: vol.summary }]
    for (const ch of chapters) {
      const n = ch.number || auto
      if (n === number) return ch.summary || ''
      auto = Math.max(auto, n) + 1
    }
  }
  return ''
}

export function coverUrl(novelId: number, updatedAt?: string) {
  const stamp = updatedAt ? `?t=${encodeURIComponent(updatedAt)}` : ''
  return `/api/novels/${novelId}/cover${stamp}`
}

export function chapterPrefix(number: number) {
  return `第${number}章`
}

/** 输入框只展示自定义标题，去掉「第N章」前缀 */
export function customChapterTitle(number: number, title: string) {
  let name = (title || '').trim()
  const prefix = chapterPrefix(number)
  if (!name || name === prefix) return ''
  if (name.startsWith(prefix)) name = name.slice(prefix.length).replace(/^[\s:：]+/, '')
  return name
}

/** 目录/阅读展示：第N章 + 自定义标题 */
export function chapterHeading(number: number, title: string) {
  const name = customChapterTitle(number, title)
  const prefix = chapterPrefix(number)
  return name ? `${prefix} ${name}` : prefix
}
