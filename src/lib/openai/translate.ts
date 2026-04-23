import { getOpenAI, callWithRetry } from './client'
import type { PaperLang } from './promptPipeline'

const LANGUAGE_NAMES: Record<PaperLang, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
}

const SYSTEM_PROMPT = (targetLang: PaperLang) =>
  `You are an academic translator. Translate the following academic paper section into ${LANGUAGE_NAMES[targetLang]}. ` +
  `Preserve the academic tone, paragraph structure, and formatting exactly. Return only the translated text.`

async function translateOne(
  text: string,
  targetLang: PaperLang,
): Promise<string> {
  if (!text.trim()) return text
  const openai = getOpenAI()
  const result = await callWithRetry((signal) =>
    openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(targetLang) },
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
  entries.forEach((k, i) => {
    result[k] = translated[i]
  })
  return result
}
