'use client'

import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ActionButton,
  AppShell,
  EmptyState,
  Eyebrow,
  MetricTile,
  PageContainer,
  SectionHeading,
  StickyColumn,
  SurfaceCard,
  ghostButtonClass,
} from '@/components/ui/surface'
import { useSitePreferences } from '@/components/ui/site-preferences-provider'

interface SectionSummary {
  topics: string[]
  sentimentLabel: 'positive' | 'neutral' | 'negative' | 'mixed'
  keyEvents: string[]
  speakerDynamics: string
}

interface AnalysisResult {
  paperId: string
  lang: string
  style: string
  detectedScores: { ko: number; en: number; ja: number }
  isMixed: boolean
  sections: string[]
  summaries?: SectionSummary[]
}

export default function ResultPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ResultDashboard />
    </Suspense>
  )
}

function ResultDashboard() {
  const router = useRouter()
  const params = useSearchParams()
  const { copy } = useSitePreferences()
  const paperId = params.get('paperId')

  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadResult() {
      if (!paperId) {
        if (!cancelled) {
          setError(copy.result.notFound)
          setLoading(false)
        }
        return
      }

        try {
          const response = await fetch(`/api/papers/${paperId}`)
          if (response.status === 401) {
            router.push(
              `/signin?callbackUrl=${encodeURIComponent(`/result?paperId=${paperId}`)}`
            )
            return
          }

        const json = await response.json()
        if (!json.ok) {
          throw new Error(json.error?.message ?? copy.result.fetchFailed)
        }

        if (!cancelled) setResult(json.data)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : copy.result.fetchFailed
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadResult()
    return () => {
      cancelled = true
    }
  }, [copy.result.fetchFailed, copy.result.notFound, paperId, router])

  if (loading) return <LoadingState />
  if (error || !result) return <ErrorState message={error || copy.result.noResult} />

  const common = copy.common
  const labels = copy.result
  const languageBreakdown = Object.entries(result.detectedScores).filter(([, score]) => score > 0)
  const topicSet = result.summaries?.flatMap((summary) => summary.topics) ?? []
  const uniqueTopics = Array.from(new Set(topicSet)).slice(0, 12)
  const allEvents = result.summaries?.flatMap((summary) => summary.keyEvents) ?? []
  const sentimentCounts =
    result.summaries?.reduce<Record<string, number>>((acc, summary) => {
      acc[summary.sentimentLabel] = (acc[summary.sentimentLabel] ?? 0) + 1
      return acc
    }, {}) ?? {}
  const dominantSentiment = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <AppShell>
      <PageContainer size="wide" className="pt-24 sm:pt-28">
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <SurfaceCard className="p-6 sm:p-8">
              <Eyebrow>{labels.eyebrow}</Eyebrow>
              <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl space-y-3">
                  <h1 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-100 sm:text-4xl">
                    {labels.title}
                  </h1>
                  <p className="text-sm leading-7 text-slate-500 dark:text-slate-400">
                    {labels.description}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Tag>
                      {common.languageLabels[result.lang as keyof typeof common.languageLabels] ??
                        result.lang}
                    </Tag>
                    {result.isMixed ? <Tag accent>{labels.mixedLanguage}</Tag> : null}
                    <Tag>{labels.sectionsCountBadge(result.sections.length)}</Tag>
                  </div>
                </div>

                <button onClick={() => router.push('/upload')} className={ghostButtonClass}>
                  {labels.newUpload}
                </button>
              </div>
            </SurfaceCard>

            <StickyColumn>
              <SurfaceCard tone="soft" className="p-6">
                <SectionHeading
                  title={labels.nextStepValue}
                  description={labels.nextStepHint}
                />
                <ActionButton
                  onClick={() => router.push(`/paper/${result.paperId}`)}
                  className="mt-5 w-full"
                >
                  {labels.openReader}
                  <ArrowRightIcon />
                </ActionButton>
              </SurfaceCard>
            </StickyColumn>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label={labels.metrics.primaryLanguage}
              value={
                common.languageLabels[result.lang as keyof typeof common.languageLabels] ??
                result.lang
              }
              accent
            />
            <MetricTile
              label={labels.metrics.writingStyle}
              value={
                common.styleLabels[result.style as keyof typeof common.styleLabels] ??
                result.style
              }
            />
            <MetricTile
              label={labels.metrics.sectionCount}
              value={String(result.sections.length)}
            />
            <MetricTile
              label={labels.metrics.sentimentFlow}
              value={
                dominantSentiment
                  ? common.sentimentLabels[
                      dominantSentiment as keyof typeof common.sentimentLabels
                    ]
                  : labels.metrics.pending
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_320px]">
            <SurfaceCard className="p-6 sm:p-7">
              <SectionHeading
                title={labels.compositionTitle}
                description={labels.compositionDescription}
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {result.sections.map((section, index) => (
                  <div
                    key={section}
                    className="flex items-center gap-3 rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <span className="w-7 text-[11px] font-semibold tracking-[0.14em] text-sky-600 dark:text-sky-300">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {common.sectionLabels[
                        section as keyof typeof common.sectionLabels
                      ] ?? section}
                    </p>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            <SurfaceCard tone="soft" className="p-6 sm:p-7">
              <SectionHeading
                title={labels.languageDistributionTitle}
                description={labels.languageDistributionDescription}
              />
              <div className="mt-5 space-y-4">
                {languageBreakdown.map(([lang, score]) => (
                  <div key={lang}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {common.languageLabels[lang as keyof typeof common.languageLabels] ?? lang}
                      </span>
                      <span className="text-xs font-semibold text-sky-600 dark:text-sky-300">
                        {Math.round(score * 100)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-slate-950 transition-all duration-700 dark:bg-sky-400"
                        style={{ width: `${Math.max(score * 100, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <InsightCard
              title={labels.insights.sentiment.title}
              description={labels.insights.sentiment.description}
            >
              {Object.keys(sentimentCounts).length ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(sentimentCounts).map(([label, count]) => (
                      <Tag key={label}>
                        {labels.insights.sentiment.badge(
                          common.sentimentLabels[
                            label as keyof typeof common.sentimentLabels
                          ] ?? label,
                          count
                        )}
                      </Tag>
                    ))}
                  </div>
                  <div className="flex h-12 items-end gap-1">
                    {result.summaries?.map((summary, index) => (
                      <div
                        key={`${summary.sentimentLabel}-${index}`}
                        className={`flex-1 rounded-t-full transition-all duration-300 ${sentimentBarClass(
                          summary.sentimentLabel
                        )}`}
                        style={{ height: sentimentHeight(summary.sentimentLabel) }}
                        title={labels.insights.sentiment.segmentTitle(
                          index + 1,
                          common.sentimentLabels[
                            summary.sentimentLabel as keyof typeof common.sentimentLabels
                          ]
                        )}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={labels.insights.sentiment.emptyTitle}
                  description={labels.insights.sentiment.emptyDescription}
                />
              )}
            </InsightCard>

            <InsightCard
              title={labels.insights.topics.title}
              description={labels.insights.topics.description}
            >
              {uniqueTopics.length ? (
                <div className="flex flex-wrap gap-2">
                  {uniqueTopics.map((topic, index) => (
                    <span
                      key={topic}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                    >
                      <span className="text-[10px] font-semibold tracking-[0.12em] text-slate-400 dark:text-slate-500">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="break-all">{topic}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={labels.insights.topics.emptyTitle}
                  description={labels.insights.topics.emptyDescription}
                />
              )}
            </InsightCard>

            <InsightCard
              title={labels.insights.events.title}
              description={labels.insights.events.description}
            >
              {allEvents.length ? (
                <ul className="space-y-3">
                  {allEvents.slice(0, 6).map((event, index) => (
                    <li
                      key={`${event}-${index}`}
                      className="flex gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <span className="mt-0.5 shrink-0 text-[11px] font-semibold tracking-[0.14em] text-sky-600 dark:text-sky-300">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {event}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={labels.insights.events.emptyTitle}
                  description={labels.insights.events.emptyDescription}
                />
              )}
            </InsightCard>
          </div>

          <SurfaceCard className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  {labels.exportStage}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-100">
                  {labels.exportTitle}
                </h2>
                <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {labels.exportDescription}
                </p>
              </div>
              <ActionButton
                onClick={() => router.push(`/paper/${result.paperId}`)}
                className="w-full lg:w-auto"
              >
                {labels.exportCta}
                <ArrowRightIcon />
              </ActionButton>
            </div>
          </SurfaceCard>
        </div>
      </PageContainer>
    </AppShell>
  )
}

function InsightCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <SurfaceCard tone="soft" className="p-6 sm:p-7">
      <SectionHeading title={title} description={description} />
      <div className="mt-5 min-w-0">{children}</div>
    </SurfaceCard>
  )
}

function LoadingState() {
  const { copy } = useSitePreferences()

  return (
    <AppShell>
      <PageContainer className="flex min-h-screen max-w-xl items-center pt-24 sm:pt-28">
        <SurfaceCard className="w-full p-8">
          <div className="space-y-4">
            <div className="skeleton h-4 w-28 rounded-full" />
            <div className="skeleton h-9 w-3/4 rounded-[18px]" />
            <div className="grid gap-3 sm:grid-cols-2">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="skeleton h-24 rounded-[24px]" />
              ))}
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {copy.result.loading}
          </p>
        </SurfaceCard>
      </PageContainer>
    </AppShell>
  )
}

function ErrorState({ message }: { message: string }) {
  const { copy } = useSitePreferences()

  return (
    <AppShell>
      <PageContainer className="flex min-h-screen max-w-xl items-center pt-24 sm:pt-28">
        <SurfaceCard className="w-full p-8 text-center">
          <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
            {copy.result.loadingErrorTitle}
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
            {message}
          </p>
          <button
            onClick={() => window.history.back()}
            className={`${ghostButtonClass} mt-6`}
          >
            {copy.result.loadingErrorBack}
          </button>
        </SurfaceCard>
      </PageContainer>
    </AppShell>
  )
}

function Tag({
  children,
  accent = false,
}: {
  children: ReactNode
  accent?: boolean
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.12em]',
        accent
          ? 'border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-300'
          : 'border-slate-200 bg-white/80 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400',
      ].join(' ')}
    >
      {children}
    </span>
  )
}

function sentimentBarClass(label: string) {
  if (label === 'positive') return 'bg-sky-400/80 dark:bg-sky-300/80'
  if (label === 'negative') return 'bg-rose-300/80 dark:bg-rose-400/60'
  if (label === 'mixed') return 'bg-violet-300/70 dark:bg-violet-400/60'
  return 'bg-slate-300 dark:bg-slate-600'
}

function sentimentHeight(label: string) {
  if (label === 'positive') return '100%'
  if (label === 'mixed') return '78%'
  if (label === 'neutral') return '58%'
  return '40%'
}

function ArrowRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}
