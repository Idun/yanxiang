import type { Chapter, Character, NamedItem, Novel, NovelReport, Relationship, Review, Settings, StudioState, Season } from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || JSON.stringify(body)
    } catch {
      detail = await res.text()
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  listNovels: () => request<Novel[]>('/api/novels'),
  getNovel: (id: number) => request<Novel>(`/api/novels/${id}`),
  createNovel: (payload: Partial<Novel> & { title: string }) =>
    request<Novel>('/api/novels', { method: 'POST', body: JSON.stringify(payload) }),
  bootstrapNovel: (premise: string) =>
    request<Novel>('/api/novels/bootstrap', { method: 'POST', body: JSON.stringify({ premise }) }),
  updateNovel: (id: number, payload: Partial<Novel>) =>
    request<Novel>(`/api/novels/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteNovel: (id: number) => request<{ ok: boolean }>(`/api/novels/${id}`, { method: 'DELETE' }),
  uploadCover: async (id: number, file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`/api/novels/${id}/cover`, { method: 'POST', body })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === 'string' ? detail : '封面上传失败')
    }
    return res.json() as Promise<Novel>
  },
  generateOutline: (id: number, payload: { chapter_count?: number; instruction?: string } = {}) =>
    request<{ ok: boolean; volumes: unknown[]; novel: Novel }>(`/api/novels/${id}/outline`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateArc: (
    id: number,
    payload: {
      theme: string
      chapter_count?: number
      start_number?: number
      instruction?: string
      thinking?: boolean
    },
  ) =>
    request<{
      ok: boolean
      theme: string
      intro: string
      arc_summary: string
      season_hook: string
      next_theme: string
      next_preview: string
      created: number
      updated: number
      start_number: number
      end_number: number
      chapters: { number: number; title: string; summary: string }[]
      season?: Season
      seasons?: Season[]
      novel: Novel
    }>(`/api/novels/${id}/arc`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listSeasons: (id: number) => request<Season[]>(`/api/novels/${id}/seasons`),
  planVolumeSeasons: (
    id: number,
    volume: number,
    payload: { instruction?: string; thinking?: boolean; replot?: boolean } = {},
  ) =>
    request<{
      ok: boolean
      volume: number
      volume_title: string
      volume_arc: string
      start_number: number
      end_number: number
      replot_count: number
      seasons: Season[]
      chapters: { number: number; title: string; summary: string; role?: string }[]
      novel: Novel
    }>(`/api/novels/${id}/volumes/${volume}/plan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateNextSeason: (
    id: number,
    payload: {
      theme?: string
      chapter_count?: number
      instruction?: string
      thinking?: boolean
    } = {},
  ) =>
    request<{
      ok: boolean
      theme: string
      intro: string
      arc_summary: string
      season_hook: string
      next_theme: string
      next_preview: string
      created: number
      updated: number
      start_number: number
      end_number: number
      chapters: { number: number; title: string; summary: string }[]
      season?: Season
      seasons?: Season[]
      novel: Novel
    }>(`/api/novels/${id}/seasons/next`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateBible: (id: number) =>
    request<{
      ok: boolean
      chapters_synced: number
      created: Record<string, number>
      novel: Novel
    }>(`/api/novels/${id}/bible`, { method: 'POST' }),
  studioState: (id: number) => request<StudioState>(`/api/novels/${id}/studio`),
  confirmStudio: (id: number) =>
    request<{ ok: boolean; kind: string; step: string; next_prompt: string; novel: Novel }>(
      `/api/novels/${id}/confirm`,
      { method: 'POST' },
    ),
  deleteChatMessage: (id: number, messageId: number, field?: string) => {
    const q = field ? `?field=${encodeURIComponent(field)}` : ''
    return request<{ ok: boolean }>(`/api/novels/${id}/chat/${messageId}${q}`, { method: 'DELETE' })
  },
  clearChat: (id: number, field?: string) => {
    const q = field ? `?field=${encodeURIComponent(field)}` : ''
    return request<{ ok: boolean }>(`/api/novels/${id}/chat${q}`, { method: 'DELETE' })
  },

  listChapters: (novelId: number) => request<Chapter[]>(`/api/novels/${novelId}/chapters`),
  createChapter: (novelId: number, payload: Partial<Chapter>) =>
    request<Chapter>(`/api/novels/${novelId}/chapters`, { method: 'POST', body: JSON.stringify(payload) }),
  updateChapter: (id: number, payload: Partial<Chapter>) =>
    request<Chapter>(`/api/chapters/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteChapter: (id: number) => request<{ ok: boolean }>(`/api/chapters/${id}`, { method: 'DELETE' }),

  listCharacters: (novelId: number) => request<Character[]>(`/api/novels/${novelId}/characters`),
  createCharacter: (novelId: number, payload: Partial<Character> & { name: string }) =>
    request<Character>(`/api/novels/${novelId}/characters`, { method: 'POST', body: JSON.stringify(payload) }),
  updateCharacter: (novelId: number, id: number, payload: Partial<Character>) =>
    request<Character>(`/api/novels/${novelId}/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCharacter: (novelId: number, id: number) =>
    request<{ ok: boolean }>(`/api/novels/${novelId}/characters/${id}`, { method: 'DELETE' }),
  keepProtagonistOnly: (novelId: number) =>
    request<{ ok: boolean; kept: string[]; removed: string[]; removed_count: number }>(
      `/api/novels/${novelId}/characters/keep-protagonist`,
      { method: 'POST' },
    ),
  recognizeCast: (chapterId: number) =>
    request<{ ok: boolean; created: number; names: string[]; relationships_updated: number }>(
      `/api/chapters/${chapterId}/recognize-cast`,
      { method: 'POST' },
    ),

  listRelationships: (novelId: number) => request<Relationship[]>(`/api/novels/${novelId}/relationships`),
  createRelationship: (novelId: number, payload: Omit<Relationship, 'id' | 'novel_id'>) =>
    request<Relationship>(`/api/novels/${novelId}/relationships`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteRelationship: (novelId: number, id: number) =>
    request<{ ok: boolean }>(`/api/novels/${novelId}/relationships/${id}`, { method: 'DELETE' }),
  syncRelationships: (novelId: number) =>
    request<{ ok: boolean; updated: number; relationships?: unknown[]; skipped?: string }>(
      `/api/novels/${novelId}/relationships/sync`,
      { method: 'POST' },
    ),

  listItems: (novelId: number) => request<NamedItem[]>(`/api/novels/${novelId}/items`),
  createItem: (novelId: number, payload: { name: string; description?: string }) =>
    request<NamedItem>(`/api/novels/${novelId}/items`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteItem: (novelId: number, id: number) =>
    request<{ ok: boolean }>(`/api/novels/${novelId}/items/${id}`, { method: 'DELETE' }),

  listLocations: (novelId: number) => request<NamedItem[]>(`/api/novels/${novelId}/locations`),
  createLocation: (novelId: number, payload: { name: string; description?: string }) =>
    request<NamedItem>(`/api/novels/${novelId}/locations`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteLocation: (novelId: number, id: number) =>
    request<{ ok: boolean }>(`/api/novels/${novelId}/locations/${id}`, { method: 'DELETE' }),

  listEvents: (novelId: number) => request<NamedItem[]>(`/api/novels/${novelId}/events`),
  createEvent: (novelId: number, payload: { name: string; description?: string; timeline?: string }) =>
    request<NamedItem>(`/api/novels/${novelId}/events`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteEvent: (novelId: number, id: number) =>
    request<{ ok: boolean }>(`/api/novels/${novelId}/events/${id}`, { method: 'DELETE' }),

  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (payload: Partial<{ deepseek_api_key: string; deepseek_model: string; deepseek_base_url: string }>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  healthSettings: () => request<{ ok: boolean; message: string; models?: string[] }>('/api/settings/health'),

  listReviews: (chapterId: number) => request<Review[]>(`/api/chapters/${chapterId}/reviews`),
  runReview: (chapterId: number) => request<Review>(`/api/chapters/${chapterId}/review`, { method: 'POST' }),
  runReader: (chapterId: number) => request<Review>(`/api/chapters/${chapterId}/reader`, { method: 'POST' }),
  novelReport: (novelId: number) => request<NovelReport>(`/api/novels/${novelId}/report`),
}

export type StreamEvent = {
  type: string
  text?: string
  message?: string
  word_count?: number
  summary?: string
  content?: string
  stage?: string
  label?: string
  data?: unknown
  review?: unknown
  reader?: unknown
  continuity?: {
    pass?: boolean
    score?: number
    prev_hook?: string
    issues?: string[]
    opening_ok?: boolean
  }
  pass?: boolean
  score?: number
  prev_hook?: string
  issues?: unknown
  opening_ok?: boolean
  fields?: string[]
  novel?: unknown
  focus?: string
  scene_count?: number
  number?: number
  title?: string
  updated?: number
  names?: string[]
  items?: unknown
}

export async function streamSse(
  path: string,
  body: unknown | undefined,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : '请求失败')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.trim()
      if (!line.startsWith('data:')) continue
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent)
      } catch {
        /* 忽略半包或损坏的 SSE 行，避免整次生成被前端解析打断 */
      }
    }
  }
}

export async function streamChat(
  novelId: number,
  content: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
  field?: string,
  thinking?: boolean,
) {
  const body: Record<string, unknown> = { content, thinking: Boolean(thinking) }
  if (field) body.field = field
  await streamSse(`/api/novels/${novelId}/chat`, body, onEvent, signal)
}

export async function streamGenerate(
  chapterId: number,
  body: {
    mode: 'lottery' | 'plot'
    instruction: string
    target_words: number
    character_ids: number[]
    polish?: boolean
    plan?: boolean
    thinking?: boolean
  },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  await streamSse(`/api/chapters/${chapterId}/generate`, body, onEvent, signal)
}
