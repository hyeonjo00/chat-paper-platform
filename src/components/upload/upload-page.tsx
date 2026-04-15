'use client'

import type {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
} from 'react'
import { useRef, useState } from 'react'
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

type Status = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error'

const ACCEPT = '.txt,.md,.json,.zip'
const MAX_MB = 3072

const PROGRESS: Record<Status, number> = {
  idle: 0,
  uploading: 36,
  analyzing: 88,
  done: 100,
  error: 0,
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

  const isBusy = status === 'uploading' || status === 'analyzing'
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

    const ext = nextFile.name.split('.').pop()?.toLowerCase()
    if (!['txt', 'md', 'json', 'zip'].includes(ext ?? '')) {
      setError(labels.errors.invalidType)
      return
    }

    setFile(nextFile)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return

    setError('')

    try {
      setStatus('uploading')
      const formData = new FormData()
      formData.append('file', file)

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (uploadResponse.status === 401) {
        router.push('/api/auth/signin?callbackUrl=%2Fupload')
        return
      }

      const uploadJson = await uploadResponse.json()
      if (!uploadResponse.ok || !uploadJson.ok) {
        throw new Error(uploadJson.error?.message ?? labels.errors.uploadFailed)
      }

      setStatus('analyzing')
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: uploadJson.data.uploadId }),
      })

      if (analyzeResponse.status === 401) {
        router.push('/api/auth/signin?callbackUrl=%2Fupload')
        return
      }

      const analyzeJson = await analyzeResponse.json()
      if (!analyzeResponse.ok || !analyzeJson.ok) {
        throw new Error(analyzeJson.error?.message ?? labels.errors.analyzeFailed)
      }

      setPaperId(analyzeJson.data.paperId)
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
                  <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                    {labels.formTitle}
                  </p>
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
                          : labels.statusAnalyzing}
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
                        : labels.statusAnalyzingHint}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <ActionButton type="submit" disabled={!file || isBusy} className="flex-1">
                    {isBusy
                      ? status === 'uploading'
                        ? labels.statusUploading
                        : labels.statusAnalyzing
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
