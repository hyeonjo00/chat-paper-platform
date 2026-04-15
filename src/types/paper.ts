export type PaperLanguage = 'KO' | 'EN' | 'JA'

export type WritingStyle =
  | 'PSYCHOLOGY_PAPER'
  | 'COMMUNICATION_ANALYSIS'
  | 'RELATIONSHIP_DYNAMICS'
  | 'SOCIOLOGY'
  | 'BEHAVIORAL_SCIENCE'
  | 'COMPUTATIONAL_TEXT'
  | 'BIOINFORMATICS'

export interface PaperReference {
  id: string
  authors: string[]
  year: number
  title: string
  venue?: string
  url?: string
}

export interface PaperSections {
  abstract: string
  introduction: string
  relatedWork: string
  methods: string
  results: string
  discussion: string
  conclusion: string
}

export interface GeneratedPaper {
  title: string
  language: PaperLanguage
  writingStyle: WritingStyle
  sections: PaperSections
  references: PaperReference[]
  appendix?: string
}
