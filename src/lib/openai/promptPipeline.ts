import { openai, callWithRetry } from './client'
import { DetectionResult } from '@/lib/nlp/languageDetector'

export type PaperLang = 'ko' | 'en' | 'ja'
export type WritingStyle =
  | 'psychology_paper'
  | 'communication_analysis'
  | 'relationship_dynamics'
  | 'sociology'
  | 'behavioral_science'
  | 'computational_text'
  | 'bioinformatics'

export type PaperSection =
  | 'title' | 'abstract' | 'introduction' | 'related_work'
  | 'methods' | 'results' | 'discussion' | 'conclusion'

// ── Layer 1: Language Detection ───────────────────────────────────────────────

export async function detectLanguageWithLLM(
  samples: string[]
): Promise<{ ko: number; en: number; ja: number }> {
  const content = await callWithRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Analyze text samples and return language ratio as JSON: {"ko":0.0,"en":0.0,"ja":0.0}. Values must sum to 1.0.',
        },
        {
          role: 'user',
          content: samples.slice(0, 80).join('\n'),
        },
      ],
    })
  )

  try {
    const parsed = JSON.parse(content.choices[0].message.content ?? '{}')
    const { ko = 0, en = 0, ja = 0 } = parsed
    const sum = ko + en + ja || 1
    return { ko: ko / sum, en: en / sum, ja: ja / sum }
  } catch {
    return { ko: 0, en: 0, ja: 0 }
  }
}

// ── Layer 2: Chunk Summary ─────────────────────────────────────────────────────

export interface ChunkSummary {
  topics: string[]
  sentimentLabel: 'positive' | 'neutral' | 'negative' | 'mixed'
  keyEvents: string[]
  speakerDynamics: string
  speakerCount: number
  speakerProfiles: { speakerId: string; traits: string; messageShare: string }[]
  groupDynamics?: string
}

export async function summariseChunk(
  messages: { speakerId: string; text: string }[],
  contextHeader: string,
  lang: PaperLang
): Promise<ChunkSummary> {
  const langNote = lang === 'ko' ? '한국어로 답하라.' : lang === 'ja' ? '日本語で答えてください。' : 'Answer in English.'
  const dialogue = messages.map(m => `${m.speakerId}: ${m.text}`).join('\n')

  const speakerIds = Array.from(new Set(messages.map(m => m.speakerId)))
  const isGroup = speakerIds.length > 2
  const speakerNote = isGroup
    ? `이 대화는 ${speakerIds.length}명이 참여하는 단체 채팅방입니다. 각 화자의 역할, 발화 비중, 상호작용 패턴을 개별적으로 분석하라.`
    : `이 대화는 1:1 대화입니다. 두 화자 간의 관계 역학을 분석하라.`

  const content = await callWithRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a conversation analyst. Context: ${contextHeader}. ${speakerNote} ${langNote}
Return JSON:
{
  "topics": ["string"],
  "sentimentLabel": "positive|neutral|negative|mixed",
  "keyEvents": ["string"],
  "speakerDynamics": "string (overall group/pair interaction summary)",
  "speakerCount": number,
  "speakerProfiles": [
    { "speakerId": "string", "traits": "string (communication style, role in group)", "messageShare": "string (e.g. 35%)" }
  ],
  "groupDynamics": "string (for group chats: subgroup formations, dominant speakers, conflict/consensus patterns)"
}`,
        },
        { role: 'user', content: dialogue },
      ],
    })
  )

  try {
    return JSON.parse(content.choices[0].message.content ?? '{}') as ChunkSummary
  } catch {
    return { topics: [], sentimentLabel: 'neutral', keyEvents: [], speakerDynamics: '', speakerCount: speakerIds.length, speakerProfiles: [] }
  }
}

// ── Layer 2.5: Relationship Analysis ─────────────────────────────────────────

export interface RelationshipAnalysis {
  relationshipType: string   // 예: 연인, 친구, 가족, 직장동료, 온라인친구 등
  confidence: number         // 0~1
  issues: string[]           // 발견된 문제점 (없으면 빈 배열)
  hasIssues: boolean
  isRomantic: boolean
  affectionScores?: { speakerId: string; score: number; reasoning: string }[]
}

export async function analyseRelationship(
  messages: { speakerId: string; text: string }[],
  lang: PaperLang
): Promise<RelationshipAnalysis> {
  const langNote = lang === 'ko' ? '한국어로 답하라.' : lang === 'ja' ? '日本語で答えてください。' : 'Answer in English.'
  const sample = messages.slice(0, 200).map(m => `${m.speakerId}: ${m.text}`).join('\n')
  const speakerIds = Array.from(new Set(messages.map(m => m.speakerId)))

  const content = await callWithRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a relationship psychologist analyzing conversation data. ${langNote}
Infer the relationship type and detect any communication problems.
If romantic, estimate each person's affection level based on language patterns, response frequency, emotional expressions, and care shown.

Return JSON:
{
  "relationshipType": "string (e.g. 연인, 친구, 가족, 직장동료, 온라인친구)",
  "confidence": 0.0~1.0,
  "isRomantic": boolean,
  "hasIssues": boolean,
  "issues": ["string"] (communication problems, conflicts, imbalance — empty array if none),
  "affectionScores": [
    { "speakerId": "string", "score": 0~100, "reasoning": "string" }
  ] (only if isRomantic is true, otherwise omit or empty array)
}`,
        },
        { role: 'user', content: `화자 목록: ${speakerIds.join(', ')}\n\n대화:\n${sample}` },
      ],
    })
  )

  try {
    return JSON.parse(content.choices[0].message.content ?? '{}') as RelationshipAnalysis
  } catch {
    return { relationshipType: '알 수 없음', confidence: 0, issues: [], hasIssues: false, isRomantic: false }
  }
}

// ── Layer 3: Paper Section Generation ────────────────────────────────────────

const STYLE_NOTES: Record<WritingStyle, string> = {
  psychology_paper:        'Use clinical psychology conventions. Apply hypothesis-testing structure. Reference DSM where relevant.',
  communication_analysis:  'Apply pragmatics and speech-act theory (Austin/Searle). Analyse turn-taking patterns.',
  relationship_dynamics:   'Use relationship science and attachment theory (Bowlby/Ainsworth). Focus on intimacy and conflict cycles.',
  sociology:               'Use qualitative sociology and grounded theory. Emphasise social context and structural factors.',
  behavioral_science:      'Quantify behavioural patterns: frequency, reinforcement, extinction. Apply operant conditioning framing.',
  computational_text:      'Include NLP metrics (TF-IDF, topic modelling, sentiment classification). Use formal notation.',
  bioinformatics:          'Model conversation as time-series and network interactions. Use systems-biology metaphors.',
}

const SECTION_INSTRUCTIONS: Record<PaperSection, string> = {
  title:        'Generate a concise academic title (max 20 words) reflecting the conversation analysis.',
  abstract:     'Write a 150–250 word structured abstract: Background, Methods, Results, Conclusion.',
  introduction: 'Introduce the research context, state the research questions, and justify the study.',
  related_work: 'Review 6–10 relevant prior works with [Author, Year] citation placeholders.',
  methods:      'Describe data collection, anonymisation procedure, analysis approach, and tools used.',
  results:      'Present quantitative and qualitative findings. Include topic clusters, sentiment trend, and key events.',
  discussion:   'Interpret findings in light of theory. Acknowledge limitations.',
  conclusion:   'Summarise contributions, practical implications, and future directions.',
}

export interface GenerateSectionOptions {
  section: PaperSection
  analysisContext: string   // JSON string of aggregated ChunkSummary[]
  lang: PaperLang
  style: WritingStyle
  speakerCount?: number
  existingSection?: string  // pass for iterative refinement
}

export async function generatePaperSection(opts: GenerateSectionOptions): Promise<string> {
  const { section, analysisContext, lang, style, speakerCount = 2, existingSection } = opts

  const langInstr =
    lang === 'ko' ? '한국어 학술 문체로 작성하라.' :
    lang === 'ja' ? '日本語の学術文体で書いてください。' :
    'Write in formal academic English.'

  const groupNote = speakerCount > 2
    ? `This is a GROUP CHAT with ${speakerCount} participants. Analyse multi-party interaction dynamics, subgroup formations, dominant/passive speakers, and collective sentiment patterns. Reference individual speaker profiles where relevant.`
    : `This is a 1-on-1 conversation between 2 participants. Analyse dyadic interaction and relational dynamics.`

  const refineNote = existingSection
    ? `\n\nExisting draft to improve:\n${existingSection}`
    : ''

  const content = await callWithRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `You are an academic writer with a PhD.
Style: ${STYLE_NOTES[style]}
Conversation type: ${groupNote}
Task: ${SECTION_INSTRUCTIONS[section]}
${langInstr}
Preserve any quoted dialogue blocks exactly as provided. Use [Author, Year] for citation placeholders.${refineNote}`,
        },
        {
          role: 'user',
          content: `Analysis data:\n${analysisContext}`,
        },
      ],
    })
  )

  return content.choices[0].message.content?.trim() ?? ''
}
