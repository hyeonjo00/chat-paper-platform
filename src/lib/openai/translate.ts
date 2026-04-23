import { getOpenAI, callWithRetry } from './client'
import type { PaperLang } from './promptPipeline'

const LANGUAGE_NAMES: Record<PaperLang, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
}

const SECTION_PROMPT = (targetLang: PaperLang) =>
  `You are an academic translator. Translate the following academic paper section into ${LANGUAGE_NAMES[targetLang]}. ` +
  `Preserve the academic tone, paragraph structure, and formatting exactly. Return only the translated text.`

const SHORT_PROMPT = (targetLang: PaperLang) =>
  `Translate the following short phrase into ${LANGUAGE_NAMES[targetLang]}. Return only the translated text, nothing else.`

async function translateOne(
  text: string,
  targetLang: PaperLang,
  short = false,
): Promise<string> {
  if (!text.trim()) return text
  const openai = getOpenAI()
  const result = await callWithRetry((signal) =>
    openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: short ? SHORT_PROMPT(targetLang) : SECTION_PROMPT(targetLang) },
          { role: 'user', content: text },
        ],
      },
      { signal },
    ),
  )
  return result.choices[0].message.content ?? text
}

export type TranslatableSections = {
  title?: string | null
  abstract?: string | null
  introduction?: string | null
  methods?: string | null
  results?: string | null
  discussion?: string | null
  conclusion?: string | null
}

export type AffectionScore = {
  speakerId: string
  score: number
  reasoning: string
}

export type TranslatableRelationship = {
  relationshipType?: string | null
  relationshipIssues?: string | null
  affectionScores?: AffectionScore[] | null
}

export async function translatePaper(
  sections: TranslatableSections,
  targetLang: PaperLang,
): Promise<TranslatableSections> {
  const keys = Object.keys(sections) as (keyof TranslatableSections)[]
  const entries = keys.filter((k) => sections[k])

  const translated = await Promise.all(
    entries.map((k) => translateOne(sections[k]!, targetLang)),
  )

  const result: TranslatableSections = {}
  entries.forEach((k, i) => { result[k] = translated[i] })
  return result
}

export async function translateRelationship(
  rel: TranslatableRelationship,
  targetLang: PaperLang,
): Promise<TranslatableRelationship> {
  const tasks: Promise<void>[] = []
  const result: TranslatableRelationship = {}

  if (rel.relationshipType) {
    tasks.push(
      translateOne(rel.relationshipType, targetLang, true).then((t) => { result.relationshipType = t }),
    )
  }

  if (rel.relationshipIssues) {
    // Translate issues as a block (newline-separated) to preserve structure
    tasks.push(
      translateOne(rel.relationshipIssues, targetLang, false).then((t) => { result.relationshipIssues = t }),
    )
  }

  if (rel.affectionScores?.length) {
    const reasonings = rel.affectionScores.map((s) => s.reasoning).filter(Boolean)
    const translatedReasonings = await Promise.all(
      reasonings.map((r) => translateOne(r, targetLang, false)),
    )
    result.affectionScores = rel.affectionScores.map((s, i) => ({
      ...s,
      reasoning: translatedReasonings[i] ?? s.reasoning,
    }))
  }

  await Promise.all(tasks)
  return result
}
