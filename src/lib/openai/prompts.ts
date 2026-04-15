import { PaperLanguage, WritingStyle } from '@/types/paper'

// ── Layer 1: Language Detection ───────────────────────────────────────────────
export const LANGUAGE_DETECTION_SYSTEM = `You are a language detection expert.
Analyze the given text samples and return a JSON object with language ratios.
Output ONLY valid JSON: {"ko": 0.0, "en": 0.0, "ja": 0.0}
The values must sum to 1.0.`

export function buildLanguageDetectionMessages(samples: string[]) {
  return [
    { role: 'system' as const, content: LANGUAGE_DETECTION_SYSTEM },
    { role: 'user' as const, content: `Analyze these ${samples.length} message samples:\n\n${samples.slice(0, 100).join('\n')}` },
  ]
}

// ── Layer 2: Dialogue Parsing ─────────────────────────────────────────────────
export function buildDialogueParsingMessages(chunk: string, contextHeader: string) {
  return [
    {
      role: 'system' as const,
      content: `You are a conversation analyst. Analyze dialogue structure and classify each speaker's role and intent.
Context: ${contextHeader}
Return JSON: { "speakers": [{"id","role","turnCount"}], "timeline": [{"t","speakerId","intent","summary"}] }`,
    },
    { role: 'user' as const, content: chunk },
  ]
}

// ── Layer 3: Thematic Analysis ────────────────────────────────────────────────
export function buildThematicAnalysisMessages(chunk: string, contextHeader: string) {
  return [
    {
      role: 'system' as const,
      content: `You are a qualitative researcher specializing in conversation analysis.
Context: ${contextHeader}
Identify topics, sentiment trends, relationship patterns, key events, and theme evolution.
Return JSON matching this schema:
{
  "topicClusters": [{"label":"string","keywords":["string"],"weight":0.0}],
  "sentimentTrend": [{"t":"ISO","valence":0.0,"arousal":0.0}],
  "relationshipPatterns": {"reciprocity":0.0,"dominance":0.0,"intimacy":0.0},
  "events": [{"t":"ISO","type":"string","description":"string"}],
  "themeEvolution": [{"phase":"string","themes":["string"]}],
  "emotionalChanges": [{"phase":"string","from":"string","to":"string"}]
}`,
    },
    { role: 'user' as const, content: chunk },
  ]
}

// ── Layer 4: Academic Writing ─────────────────────────────────────────────────
const STYLE_PROMPTS: Record<WritingStyle, string> = {
  PSYCHOLOGY_PAPER: '임상심리학 학술 논문 형식. 가설-검증 구조. DSM 기준 준수. 객관적 3인칭 서술.',
  COMMUNICATION_ANALYSIS: '화용론·담화분석 관점. 화행이론(Austin/Searle) 적용. 대화 순서교대 분석 포함.',
  RELATIONSHIP_DYNAMICS: '관계과학·애착이론(Bowlby/Ainsworth) 관점. 친밀도·갈등·회복 패턴 중심.',
  SOCIOLOGY: '질적 사회학·근거이론(Grounded Theory) 방법론. 사회적 맥락과 구조 강조.',
  BEHAVIORAL_SCIENCE: '행동분석 관점. 빈도·강화·소거 패턴 정량화. 조작적 조건형성 이론 적용.',
  COMPUTATIONAL_TEXT: 'NLP 정량분석. TF-IDF, 토픽 모델링, 감성 분류 지표 포함. 수식 및 알고리즘 기술.',
  BIOINFORMATICS: '시계열·네트워크 분석 메타포 적용. 대화를 분자 상호작용 패턴으로 모델링.',
}

export function buildAcademicWritingMessages(
  analysisJson: string,
  section: string,
  language: PaperLanguage,
  style: WritingStyle
) {
  const langInstr = language === 'KO' ? '한국어로 작성' : language === 'JA' ? '日本語で作成' : 'Write in English'
  return [
    {
      role: 'system' as const,
      content: `You are an academic writer with a PhD. ${STYLE_PROMPTS[style]}
${langInstr}. Write the "${section}" section of an academic paper based on the analysis data.
Use formal academic tone. Include appropriate citations as [Author, Year] placeholders.`,
    },
    { role: 'user' as const, content: `Analysis data:\n${analysisJson}` },
  ]
}

// ── Layer 5: Citation Formatting ──────────────────────────────────────────────
export function buildCitationMessages(bodyText: string, language: PaperLanguage) {
  const style = language === 'KO' ? 'KCI 한국학술지' : language === 'JA' ? 'SIST02' : 'APA 7th edition'
  return [
    {
      role: 'system' as const,
      content: `Format all citation placeholders in the text using ${style} style.
Return JSON: { "formattedBody": "text with citations", "references": [{"id","authors":[],"year","title","venue","url"}] }`,
    },
    { role: 'user' as const, content: bodyText },
  ]
}

// ── Layer 6: Multilingual Rewriting ──────────────────────────────────────────
export function buildMultilingualRewritingMessages(
  bodyText: string,
  sourceLang: PaperLanguage,
  targetLang: PaperLanguage
) {
  const targetName = targetLang === 'KO' ? '한국어' : targetLang === 'JA' ? '日本語' : 'English'
  return [
    {
      role: 'system' as const,
      content: `Translate the academic text from ${sourceLang} to ${targetName}.
Rules:
1. Preserve all quoted dialogue blocks (marked with "> ") in their original language.
2. Add a footnote translation for each quoted block: [역주: ...]
3. Use formal academic register appropriate for ${targetName}.
4. Preserve citation markers [Author, Year] unchanged.`,
    },
    { role: 'user' as const, content: bodyText },
  ]
}
