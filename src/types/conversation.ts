export interface NormalizedMessage {
  id: string
  speakerId: string
  originalSpeaker?: string
  timestamp: string
  text: string
  lang?: 'ko' | 'en' | 'ja' | 'unknown'
}

export interface ParsedConversationData {
  messages: NormalizedMessage[]
  speakers: { id: string; turnCount: number; firstSeen: string }[]
  dateRange: { start: string; end: string }
  totalMessages: number
  speakerCount: number
}

export type UploadFileType = 'KAKAO' | 'AI_CONVERSATION' | 'INSTAGRAM' | 'LINE'

export interface ParseOptions {
  anonymize: boolean
  type?: UploadFileType
}

export interface LanguageBreakdown {
  ko: number
  en: number
  ja: number
}
