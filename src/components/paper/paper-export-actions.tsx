'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ActionButton,
  Eyebrow,
  SecondaryButton,
  SurfaceCard,
} from '@/components/ui/surface'
import { useSitePreferences } from '@/components/ui/site-preferences-provider'

type ExportSection = { label: string; paragraphs: string[] }
type PaperExportActionsProps = { title: string; sections: ExportSection[] }

export default function PaperExportActions({
  title,
  sections,
}: PaperExportActionsProps) {
  const { copy } = useSitePreferences()
  const labels = copy.export
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [isPrinting, startPrintTransition] = useTransition()

  const exportText = useMemo(() => {
    return [
      title,
      ...sections.flatMap((section) => ['', `[${section.label}]`, ...section.paragraphs]),
    ].join('\n')
  }, [sections, title])

  function downloadText() {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugifyTitle(title)}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function copyText() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(exportText)
      setCopyError('')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError(labels.copyError)
    }
  }

  function printAsPdf() {
    startPrintTransition(() => {
      window.print()
    })
  }

  return (
    <SurfaceCard tone="soft" className="p-5">
      <div className="space-y-3">
        <Eyebrow>{labels.eyebrow}</Eyebrow>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
            {labels.title}
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
            {labels.description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          labels.chips.text,
          labels.chips.pdf,
          labels.chips.copy,
        ].map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-2.5">
        <ActionButton onClick={downloadText} className="w-full">
          {labels.actions.download}
          <DownloadIcon />
        </ActionButton>
        <SecondaryButton onClick={printAsPdf} className="w-full">
          {isPrinting ? labels.actions.printing : labels.actions.print}
          <PrintIcon />
        </SecondaryButton>
        <SecondaryButton onClick={() => void copyText()} className="w-full">
          {copied ? (
            <>
              <CheckIcon />
              {labels.actions.copied}
            </>
          ) : (
            <>
              {labels.actions.copy}
              <CopyIcon />
            </>
          )}
        </SecondaryButton>
      </div>

      <p className="mt-4 text-xs leading-6 text-slate-500 dark:text-slate-400">
        {labels.note}
      </p>
      {copyError ? (
        <p className="mt-2 text-xs leading-6 text-rose-600 dark:text-rose-300">
          {copyError}
        </p>
      ) : null}
    </SurfaceCard>
  )
}

function slugifyTitle(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return 'chat-paper-export'
  return trimmed.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 64)
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75v10.5m0 0l-4.5-4.5m4.5 4.5l4.5-4.5M4.5 15.75v1.5A2.25 2.25 0 006.75 19.5h10.5a2.25 2.25 0 002.25-2.25v-1.5" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5V4.875A1.875 1.875 0 018.625 3h6.75A1.875 1.875 0 0117.25 4.875V7.5M6 15h12m-12 0v3.375A1.125 1.125 0 007.125 19.5h9.75A1.125 1.125 0 0018 18.375V15M6 15H4.875A1.875 1.875 0 013 13.125V9.375A1.875 1.875 0 014.875 7.5h14.25A1.875 1.875 0 0121 9.375v3.75A1.875 1.875 0 0119.125 15H18" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v1.125A1.125 1.125 0 0114.625 19.5H6.375A1.125 1.125 0 015.25 18.375V7.125A1.125 1.125 0 016.375 6h1.125m3.75-1.5h6.375A1.125 1.125 0 0118.75 5.625v8.25A1.125 1.125 0 0117.625 15h-6.375a1.125 1.125 0 01-1.125-1.125v-8.25A1.125 1.125 0 0111.25 4.5z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}
