import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
} from 'docx'
import type { GeneratedPaper } from '@/lib/services/paperGenerator'
import type { PaperLang } from '@/lib/openai/promptPipeline'

export type ExportFormat = 'pdf' | 'docx'

export interface ExportInput {
  paper: GeneratedPaper
  lang: PaperLang
  format: ExportFormat
}

const LABELS: Record<PaperLang, Record<string, string>> = {
  ko: { abstract: '초록', introduction: '서론', methods: '연구 방법', results: '결과', discussion: '논의', conclusion: '결론' },
  en: { abstract: 'Abstract', introduction: 'Introduction', methods: 'Methods', results: 'Results', discussion: 'Discussion', conclusion: 'Conclusion' },
  ja: { abstract: '要旨', introduction: '序論', methods: '研究方法', results: '結果', discussion: '考察', conclusion: '結論' },
}

const ORDERED_SECTIONS: (keyof Omit<GeneratedPaper, 'title'>)[] = [
  'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion',
]

// ── DOCX ──────────────────────────────────────────────────────────────────────

function buildDocx(paper: GeneratedPaper, lang: PaperLang): Document {
  const labels = LABELS[lang]
  const children: Paragraph[] = []

  children.push(new Paragraph({
    text: paper.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }))

  for (const key of ORDERED_SECTIONS) {
    const content = paper[key]
    if (!content) continue
    children.push(new Paragraph({
      text: labels[key] ?? key,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }))
    for (const para of content.split('\n\n').filter(Boolean)) {
      children.push(new Paragraph({
        children: [new TextRun({ text: para.replace(/\n/g, ' '), size: 24 })],
        spacing: { after: 200 },
      }))
    }
    children.push(new Paragraph({ children: [new PageBreak()] }))
  }

  return new Document({ sections: [{ children }] })
}

export async function exportDocx(paper: GeneratedPaper, lang: PaperLang): Promise<Buffer> {
  return Packer.toBuffer(buildDocx(paper, lang))
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function exportPdf(paper: GeneratedPaper, lang: PaperLang): Promise<Buffer> {
  const { renderToBuffer, Document: PdfDoc, Page, Text, View, StyleSheet } =
    await import('@react-pdf/renderer')

  const labels = LABELS[lang]

  const styles = StyleSheet.create({
    page:    { padding: 72, fontFamily: 'Helvetica' },
    title:   { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
    heading: { fontSize: 13, fontWeight: 'bold', marginTop: 24, marginBottom: 8 },
    body:    { fontSize: 10, lineHeight: 1.6, marginBottom: 6 },
  })

  const sections = ORDERED_SECTIONS.filter(k => !!paper[k])

  const element = (
    <PdfDoc>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{paper.title}</Text>
        {sections.map(key => (
          <View key={key}>
            <Text style={styles.heading}>{labels[key] ?? key}</Text>
            {(paper[key] as string).split('\n\n').filter(Boolean).map((p, i) => (
              <Text key={i} style={styles.body}>{p.replace(/\n/g, ' ')}</Text>
            ))}
          </View>
        ))}
      </Page>
    </PdfDoc>
  )

  return renderToBuffer(element) as Promise<Buffer>
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function exportDocument(input: ExportInput): Promise<Buffer> {
  return input.format === 'docx'
    ? exportDocx(input.paper, input.lang)
    : exportPdf(input.paper, input.lang)
}
