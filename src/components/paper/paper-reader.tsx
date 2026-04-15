import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/options'
import { prisma } from '@/lib/db/prisma'
import { SITE_LOCALE_COOKIE, getSiteCopy, resolveSiteLocale } from '@/lib/ui/site-copy'
import {
  AppShell,
  EmptyState,
  Eyebrow,
  MetricTile,
  PageContainer,
  SectionHeading,
  StickyColumn,
  SurfaceCard,
  ghostButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/surface'
import PaperExportActions from '@/components/paper/paper-export-actions'

const SECTION_ORDER = [
  'abstract',
  'introduction',
  'methods',
  'results',
  'discussion',
  'conclusion',
] as const

type PageProps = { params: { paperId: string } }

export default async function PaperReader({ params }: PageProps) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/paper/${params.paperId}`)}`)
  }

  const locale = resolveSiteLocale(cookies().get(SITE_LOCALE_COOKIE)?.value)
  const copy = getSiteCopy(locale)
  const common = copy.common
  const labels = copy.paper

  const paper = await prisma.paper.findFirst({
    where: { id: params.paperId, userId: session.user.id },
    select: {
      id: true,
      title: true,
      language: true,
      writingStyle: true,
      generatedAt: true,
      abstract: true,
      introduction: true,
      methods: true,
      results: true,
      discussion: true,
      conclusion: true,
    },
  })

  if (!paper) notFound()

  const sections = SECTION_ORDER.flatMap((key) => {
    const paragraphs = splitParagraphs(paper[key])
    if (!paragraphs.length) return []

    return [
      {
        key,
        label: common.sectionLabels[key],
        paragraphs,
      },
    ]
  })

  const paragraphCount = sections.reduce(
    (total, section) => total + section.paragraphs.length,
    0
  )
  const characterCount = sections.reduce(
    (total, section) => total + section.paragraphs.join('').replace(/\s+/g, '').length,
    0
  )
  const readingMinutes = Math.max(1, Math.ceil(characterCount / 750))

  return (
    <AppShell>
      <PageContainer size="wide" className="pt-24 sm:pt-28">
        <div className="space-y-4">
          <SurfaceCard className="p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <Eyebrow>{labels.eyebrow}</Eyebrow>
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-100 sm:text-4xl lg:text-[2.9rem]">
                    {paper.title || labels.untitled}
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                    {labels.description}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <MetaPill
                    label={labels.meta.language}
                    value={
                      common.languageLabels[
                        paper.language as keyof typeof common.languageLabels
                      ]
                    }
                  />
                  <MetaPill
                    label={labels.meta.style}
                    value={
                      common.styleLabels[
                        paper.writingStyle as keyof typeof common.styleLabels
                      ]
                    }
                  />
                  {paper.generatedAt ? (
                    <MetaPill
                      label={labels.meta.generatedAt}
                      value={paper.generatedAt.toLocaleString(locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[210px]">
                {sections.length ? (
                  <a href={`#${sections[0].key}`} className={primaryButtonClass}>
                    {labels.ctas.readFromStart}
                    <ArrowDownIcon />
                  </a>
                ) : null}
                <Link href={`/result?paperId=${paper.id}`} className={secondaryButtonClass}>
                  {labels.ctas.backToResult}
                </Link>
                <Link href="/upload" className={ghostButtonClass}>
                  {labels.ctas.newUpload}
                </Link>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label={labels.metrics.readableSections}
                value={labels.countUnit(sections.length)}
                hint={labels.metrics.readableSectionsHint}
                accent
              />
              <MetricTile
                label={labels.metrics.paragraphs}
                value={labels.countUnit(paragraphCount)}
                hint={labels.metrics.paragraphsHint}
              />
              <MetricTile
                label={labels.metrics.readingTime}
                value={labels.readingMinutes(readingMinutes)}
                hint={labels.metrics.readingTimeHint}
              />
              <MetricTile
                label={labels.metrics.layout}
                value={labels.metrics.layoutValue}
                hint={labels.metrics.layoutHint}
              />
            </div>
          </SurfaceCard>

          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
            <StickyColumn>
              <SurfaceCard tone="soft" className="p-5">
                <SectionHeading
                  title={labels.sectionNav.title}
                  description={labels.sectionNav.description}
                />
                <nav className="mt-4 space-y-2" aria-label={labels.sectionNav.title}>
                  {sections.length ? (
                    sections.map((section, index) => (
                      <a
                        key={section.key}
                        href={`#${section.key}`}
                        className="group flex items-center gap-3 rounded-[18px] border border-transparent px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-200 hover:bg-white/90 hover:text-slate-950 dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/[0.05] dark:hover:text-white"
                      >
                        <span className="w-7 shrink-0 text-[11px] font-semibold tracking-[0.14em] text-sky-600 dark:text-sky-300">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        {section.label}
                      </a>
                    ))
                  ) : (
                    <EmptyState
                      title={labels.sectionNav.emptyTitle}
                      description={labels.sectionNav.emptyDescription}
                    />
                  )}
                </nav>
              </SurfaceCard>

              {sections.length ? (
                <PaperExportActions title={paper.title || labels.untitled} sections={sections} />
              ) : null}

              <SurfaceCard tone="soft" className="p-5">
                <SectionHeading
                  title={labels.readingTips.title}
                  description={labels.readingTips.description}
                />
                <ul className="mt-4 space-y-3">
                  {labels.readingTips.items.map((tip) => (
                    <li
                      key={tip}
                      className="rounded-[18px] border border-slate-200/80 bg-white/75 px-4 py-3 text-sm leading-6 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400"
                    >
                      {tip}
                    </li>
                  ))}
                </ul>
              </SurfaceCard>
            </StickyColumn>

            <SurfaceCard className="p-6 sm:p-8 lg:p-10">
              <div className="mx-auto max-w-3xl">
                <SectionHeading
                  title={labels.body.title}
                  description={labels.body.description}
                />

                {sections.length ? (
                  <article className="mt-10 space-y-14">
                    {sections.map((section, index) => (
                      <section key={section.key} id={section.key} className="scroll-mt-32">
                        <div className="flex items-center gap-3 border-b border-slate-200/80 pb-4 dark:border-white/10">
                          <span className="text-[11px] font-semibold tracking-[0.14em] text-sky-600 dark:text-sky-300">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                            {section.label}
                          </h2>
                          <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                            {labels.body.paragraphUnit(section.paragraphs.length)}
                          </span>
                        </div>

                        <div className="mt-6 space-y-6 text-[15px] leading-8 text-slate-700 dark:text-slate-300 sm:text-base sm:leading-9">
                          {section.paragraphs.map((paragraph, paragraphIndex) => (
                            <p
                              key={`${section.key}-${paragraphIndex}`}
                              className="whitespace-pre-wrap break-words"
                            >
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      </section>
                    ))}
                  </article>
                ) : (
                  <div className="mt-8">
                    <EmptyState
                      title={labels.body.emptyTitle}
                      description={labels.body.emptyDescription}
                    />
                  </div>
                )}
              </div>
            </SurfaceCard>
          </div>
        </div>
      </PageContainer>
    </AppShell>
  )
}

function splitParagraphs(content?: string | null) {
  return (content ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function MetaPill({ label, value }: { label: string; value?: string }) {
  if (!value) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className="text-slate-900 dark:text-slate-100">{value}</span>
    </span>
  )
}

function ArrowDownIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-6-6m6 6l6-6" />
    </svg>
  )
}
