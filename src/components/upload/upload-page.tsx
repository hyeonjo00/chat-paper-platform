'use client'

import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
} from 'react'
import { useRef, useState } from 'react'
import JSZip from 'jszip'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ActionButton,
  AppShell,
  Eyebrow,
  PageContainer,
  SecondaryButton,
  SurfaceCard,
  ghostButtonClass,
} from '@/components/ui/surface'
import { useSitePreferences } from '@/components/ui/site-preferences-provider'

type Status = 'idle' | 'uploading' | 'analyzing' | 'generating' | 'done' | 'error'

const ACCEPT = '.txt,.md,.json,.html,.htm,.zip'
const MAX_MB = 10240
const VERCEL_SAFE_TEXT_MB = 4
const VERCEL_SAFE_TEXT_BYTES = VERCEL_SAFE_TEXT_MB * 1024 * 1024

const PROGRESS: Record<Status, number> = {
  idle: 0,
  uploading: 30,
  analyzing: 55,
  generating: 80,
  done: 100,
  error: 0,
}

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function fileExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function isInstagramJson(text: string) {
  return text.includes('"timestamp_ms"') && text.includes('"sender_name"')
}

async function prepareUploadFile(
  input: File,
  errors: {
    zipMissingText: string
    zipTooLarge: (maxMb: number) => string
    zipExtractFailed: string
  }
) {
  if (fileExtension(input.name) !== 'zip') return input

  try {
    const zip = await JSZip.loadAsync(input)
    const all = Object.values(zip.files).filter(e => !e.dir)

    const byExt = (ext: string) => all.filter(e => e.name.toLowerCase().endsWith(ext))

    // Instagram ZIP: merge all message_N.json files into one JSON
    const jsonEntries = byExt('.json')
    if (jsonEntries.length > 0) {
      const texts = await Promise.all(jsonEntries.map(e => e.async('string')))
      const igJsons = texts.filter(isInstagramJson)
      if (igJsons.length > 0) {
        // Merge messages arrays from all parts
        const merged = igJsons.reduce<{ participants: unknown[]; messages: unknown[] }>(
          (acc, t) => {
            const parsed = JSON.parse(t)
            if (!acc.participants.length && parsed.participants) acc.participants = parsed.participants
            if (Array.isArray(parsed.messages)) acc.messages.push(...parsed.messages)
            return acc
          },
          { participants: [], messages: [] }
        )
        const mergedText = JSON.stringify(merged)
        const prepared = new File([mergedText], 'instagram_messages.json', { type: 'application/json' })
        if (prepared.size > VERCEL_SAFE_TEXT_BYTES) throw new Error(errors.zipTooLarge(VERCEL_SAFE_TEXT_MB))
        return prepared
      }
      // Non-Instagram JSON (e.g. ChatGPT export)
      const texts2 = await Promise.all(jsonEntries.map(async e => ({
        name: e.name.split('/').pop() ?? e.name,
        text: await e.async('string'),
      })))
      const selected = texts2.sort((a, b) => b.text.length - a.text.length)[0]
      const prepared = new File([selected.text], selected.name, { type: 'application/json' })
      if (prepared.size > VERCEL_SAFE_TEXT_BYTES) throw new Error(errors.zipTooLarge(VERCEL_SAFE_TEXT_MB))
      return prepared
    }

    // HTML (Instagram HTML export)
    const htmlEntries = byExt('.html').concat(byExt('.htm'))
    if (htmlEntries.length > 0) {
      const candidates = await Promise.all(
        htmlEntries.map(async e => ({
          name: e.name.split('/').pop() ?? e.name,
          text: await e.async('string'),
        }))
      )
      const selected = candidates.sort((a, b) => b.text.length - a.text.length)[0]
      const prepared = new File([selected.text], selected.name, { type: 'text/html' })
      if (prepared.size > VERCEL_SAFE_TEXT_BYTES) throw new Error(errors.zipTooLarge(VERCEL_SAFE_TEXT_MB))
      return prepared
    }

    // TXT (KakaoTalk / LINE)
    const txtEntries = byExt('.txt')
    if (!txtEntries.length) throw new Error(errors.zipMissingText)

    const candidates = await Promise.all(
      txtEntries.map(async (entry) => ({
        name: entry.name.split('/').pop() ?? entry.name,
        text: (await entry.async('string')).replace(/^\uFEFF/, ''),
      }))
    )
    const selected = candidates.sort((a, b) => b.text.length - a.text.length)[0]
    const prepared = new File([selected.text], selected.name, { type: 'text/plain;charset=utf-8' })
    if (prepared.size > VERCEL_SAFE_TEXT_BYTES) throw new Error(errors.zipTooLarge(VERCEL_SAFE_TEXT_MB))
    return prepared
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error(errors.zipExtractFailed)
  }
}

export default function UploadPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const { copy } = useSitePreferences()

  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [paperId, setPaperId] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const isBusy = status === 'uploading' || status === 'analyzing' || status === 'generating'
  const progress = PROGRESS[status]
  const labels = copy.upload

  function openPicker() {
    if (!isBusy) inputRef.current?.click()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const droppedFile = event.dataTransfer.files[0]
    if (droppedFile) pick(droppedFile)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (nextFile) pick(nextFile)
  }

  function pick(nextFile: File) {
    setError('')

    if (nextFile.size > MAX_MB * 1024 * 1024) {
      setError(labels.errors.maxSize(MAX_MB))
      return
    }

    const ext = fileExtension(nextFile.name)
    if (!['txt', 'md', 'json', 'html', 'htm', 'zip'].includes(ext)) {
      setError(labels.errors.invalidType)
      return
    }

    setFile(nextFile)
  }

  async function pollJobStatus(jobId: string): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      const res = await fetch(`/api/jobs/${jobId}`)
      if (!res.ok) throw new Error(labels.errors.analyzeFailed)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? labels.errors.analyzeFailed)
      const { status, paperId } = json.data
      if (status === 'COMPLETED' && paperId) return paperId as string
      if (status === 'FAILED') throw new Error(labels.errors.analyzeFailed)
      // PENDING or PROCESSING — keep polling
    }
    throw new Error(labels.errors.analyzeFailed)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return

    setError('')

    try {
      // Step 1: upload file
      setStatus('uploading')
      const preparedFile = await prepareUploadFile(file, labels.errors)
      const formData = new FormData()
      formData.append('file', preparedFile, preparedFile.name)

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const uploadJson = await uploadResponse.json()
      if (!uploadResponse.ok || !uploadJson.ok) {
        throw new Error(uploadJson.error?.message ?? labels.errors.uploadFailed)
      }

      // Step 2: analyze — enqueues worker job, returns jobId immediately
      setStatus('analyzing')
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: uploadJson.data.uploadId }),
      })

      const analyzeJson = await analyzeResponse.json()
      if (!analyzeResponse.ok || !analyzeJson.ok) {
        throw new Error(analyzeJson.error?.message ?? labels.errors.analyzeFailed)
      }

      const { jobId, reused, paperId: existingPaperId, status: existingStatus } = analyzeJson.data

      // Only skip polling when the reused job is already finished
      if (reused && existingStatus === 'COMPLETED' && existingPaperId) {
        setPaperId(existingPaperId as string)
        setStatus('done')
        return
      }

      // Step 3: poll job until worker completes (always, even for reused jobs in progress)
      setStatus('generating')
      const completedPaperId = await pollJobStatus(jobId as string)

      setPaperId(completedPaperId)
      setStatus('done')
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : labels.errors.generic
      )
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <AppShell>
        <PageContainer className="flex min-h-screen items-center justify-center pt-24 sm:pt-28">
          <SurfaceCard className="w-full max-w-md p-8 text-center sm:p-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-sky-200/80 bg-sky-50 text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-300">
              <CheckIcon />
            </div>
            <p className="mt-6 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-100">
              {labels.doneTitle}
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
              {labels.doneDescription}
            </p>
            <div className="mt-8 grid gap-2">
              <ActionButton onClick={() => router.push(`/paper/${paperId}`)} className="w-full">
                {labels.donePrimary}
              </ActionButton>
              <SecondaryButton
                onClick={() => {
                  setFile(null)
                  setStatus('idle')
                  setPaperId('')
                  setError('')
                }}
                className="w-full"
              >
                {labels.doneSecondary}
              </SecondaryButton>
            </div>
          </SurfaceCard>
        </PageContainer>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <PageContainer size="wide" className="pt-24 sm:pt-28">
        <div className="space-y-6">
          <SurfaceCard tone="glass" className="px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                  {labels.navTitle}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {labels.navDescription}
                </p>
              </div>

              <Link href="/" className={ghostButtonClass}>
                {copy.home.nav.home}
              </Link>
            </div>
          </SurfaceCard>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center">
            <div className="space-y-6">
              <Eyebrow>{labels.heroKicker}</Eyebrow>
              <div className="space-y-4">
                <h1 className="max-w-2xl text-[clamp(2.6rem,8vw,4.8rem)] font-semibold leading-[0.96] tracking-[-0.06em] text-slate-950 dark:text-slate-50">
                  {labels.heroTitle}
                </h1>
                <p className="max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {labels.heroDescription}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {labels.signals.map(([label, value]) => (
                  <SurfaceCard key={label} tone="soft" className="p-4">
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      {label}
                    </p>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-800 dark:text-slate-200">
                      {value}
                    </p>
                  </SurfaceCard>
                ))}
              </div>
            </div>

            <SurfaceCard className="overflow-hidden">
              <div className="h-1 bg-slate-100 dark:bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-slate-950 transition-all duration-700 dark:bg-sky-400"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <form onSubmit={submit} className="space-y-5 p-6 sm:p-7">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                      {labels.formTitle}
                    </p>
                    <button
                      type="button"
                      onClick={() => setGuideOpen(true)}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
                    >
                      <QuestionIcon />
                      {labels.exportGuide.title}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {labels.formDescription}
                  </p>
                </div>

                <div
                  role="button"
                  tabIndex={isBusy ? -1 : 0}
                  aria-label={labels.formTitle}
                  onKeyDown={onKeyDown}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (!isBusy) setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={openPicker}
                  className={[
                    'flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed px-6 py-8 text-center transition-colors duration-200 select-none',
                    isBusy ? 'pointer-events-none opacity-50' : 'cursor-pointer',
                    dragOver
                      ? 'border-sky-300 bg-sky-50 dark:border-sky-400/30 dark:bg-sky-500/[0.06]'
                      : file
                        ? 'border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]'
                        : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/15 dark:hover:bg-white/[0.03]',
                  ].join(' ')}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    onChange={onFileChange}
                    className="hidden"
                  />

                  {file ? (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">
                        <FileIcon />
                      </div>
                      <div>
                        <p className="max-w-[250px] truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {file.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-300">
                        {labels.stateReady}
                      </span>
                    </>
                  ) : dragOver ? (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-300">
                        <ArrowUpIcon />
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {labels.stateDrop}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {labels.stateDropHint}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-500">
                        <UploadIcon />
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {labels.stateAddFile}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {labels.stateAddHint}
                      </p>
                    </>
                  )}
                </div>

                {error ? (
                  <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-400/20 dark:bg-rose-500/[0.06] dark:text-rose-300">
                    {error}
                  </div>
                ) : null}

                {isBusy ? (
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/90 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {status === 'uploading'
                          ? labels.statusUploading
                          : status === 'analyzing'
                          ? labels.statusAnalyzing
                          : labels.statusGenerating}
                      </span>
                      <span className="text-slate-950 dark:text-sky-300">{progress}%</span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-slate-950 transition-all duration-500 dark:bg-sky-400"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      {status === 'uploading'
                        ? labels.statusUploadingHint
                        : status === 'analyzing'
                        ? labels.statusAnalyzingHint
                        : labels.statusGeneratingHint}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={!file || isBusy} className="flex-1">
                    {isBusy
                      ? status === 'uploading'
                        ? labels.statusUploading
                        : status === 'analyzing'
                        ? labels.statusAnalyzing
                        : labels.statusGenerating
                      : labels.submit}
                  </ActionButton>
                  {file && !isBusy ? (
                    <SecondaryButton type="button" onClick={openPicker}>
                      {labels.retry}
                    </SecondaryButton>
                  ) : null}
                </div>
              </form>
            </SurfaceCard>
          </div>
        </div>
      </PageContainer>

      {guideOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={() => setGuideOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-white/[0.06]">
              <p className="text-sm font-semibold tracking-[-0.02em] text-slate-900 dark:text-slate-100">
                {labels.exportGuide.title}
              </p>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/[0.06] dark:hover:text-slate-300"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <div className="space-y-6">
                {labels.exportGuide.platforms.map(platform => (
                  <div key={platform.name}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {platform.name}
                      </span>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-500 dark:border-white/10 dark:text-slate-400">
                        {platform.format}
                      </span>
                    </div>
                    <ol className="space-y-2">
                      {platform.steps.map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                            {i + 1}
                          </span>
                          <span className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H6.75A2.25 2.25 0 004.5 4.5v15A2.25 2.25 0 006.75 21.75h10.5a2.25 2.25 0 002.25-2.25V14.25z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 2.625V6.75A1.5 1.5 0 0015 8.25h4.125" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V4.5m0 0l-4.5 4.5M12 4.5l4.5 4.5M4.5 16.5v1.875A2.625 2.625 0 007.125 21h9.75a2.625 2.625 0 002.625-2.625V16.5" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5V4.5m0 0l-4.5 4.5M12 4.5l4.5 4.5" />
    </svg>
  )
}

function QuestionIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
