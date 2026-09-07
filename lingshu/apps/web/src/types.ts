export interface Novel {
  id: number
  title: string
  description: string
  genre: string
  premise: string
  world_bible: string
  power_system: string
  outline_json: string
  cover_path: string
  cover_prompt: string
  studio_step: string
  pending_kind: string
  has_pending: boolean
  confirm_label: string
  step_label: string
  step_hint: string
  next_hint: string
  has_cover: boolean
  status: string
  created_at: string
  updated_at: string
  chapter_count: number
  word_count: number
}

export interface Chapter {
  id: number
  novel_id: number
  volume: number
  number: number
  title: string
  content: string
  summary: string
  plot_brief?: string
  lock_status?: 'in_progress' | 'locked' | string
  status: string
  word_count: number
  tags_json: string
  storyline_ids_json: string
  generation_mode: string | null
  created_at: string
  updated_at: string
}

export interface Character {
  id: number
  novel_id: number
  name: string
  role: string
  personality: string
  background: string
  abilities: string
  status_text: string
  appearance_notes: string
}

export interface NamedItem {
  id: number
  novel_id: number
  name: string
  description: string
  owner?: string
  status_text?: string
  notes?: string
  timeline?: string
  related_chapters?: string
  resolved?: boolean
}

export interface Season {
  id: number
  novel_id: number
  number: number
  theme: string
  intro: string
  summary: string
  season_hook: string
  next_theme: string
  next_preview: string
  start_number: number
  end_number: number
  chapters: { number: number; title: string; summary: string }[]
}

export interface Relationship {
  id: number
  novel_id: number
  from_char_id: number
  to_char_id: number
  relation_type: string
  description: string
}

export interface Settings {
  has_api_key: boolean
  api_key_masked: string
  deepseek_model: string
  deepseek_base_url: string
}

export interface OutlineChapter {
  number: number
  title: string
  summary: string
}

export interface OutlineVolume {
  volume: number
  title: string
  summary: string
  chapters: OutlineChapter[]
}

export type OutlineNode = OutlineVolume

export interface ChatMessage {
  id: number
  novel_id: number
  role: string
  content: string
  created_at: string
}

export interface StudioStep {
  id: string
  label: string
  hint: string
  next: string
  suggest: string
}

export interface StudioState {
  novel: Novel
  messages: ChatMessage[]
  characters: Character[]
  relationships: Relationship[]
  locations: NamedItem[]
  items: NamedItem[]
  events: NamedItem[]
  step: StudioStep
}

export interface ReviewIssue {
  severity?: string
  category?: string
  quote?: string
  detail?: string
  suggestion?: string
}

export interface Review {
  id: number
  chapter_id: number
  novel_id: number
  agent: string
  overall: number
  scores: Record<string, number>
  issues: Array<ReviewIssue | string>
  suggestions: string[]
  comment: string
  created_at: string
}

export interface NovelReport {
  chapter_count: number
  reviewed_count: number
  averages: Record<string, number>
  chapters: Array<{
    id: number
    number: number
    title: string
    word_count: number
    status: string
    overall: number | null
    scores: Record<string, number>
  }>
}
