'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import {
  ActionButton,
  AppShell,
  Eyebrow,
  PageContainer,
  SecondaryButton,
  SurfaceCard,
} from '@/components/ui/surface'
import { useSitePreferences } from '@/components/ui/site-preferences-provider'

export default function SignInPage() {
  const params = useSearchParams()
  const { copy } = useSitePreferences()
  const labels = copy.signin

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const callbackUrl = params.get('callbackUrl') || '/upload'
  const providerError = params.get('error')

  async function handleCredentialsSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    const result = await signIn('credentials', {
      email,
      password,
      callbackUrl,
      redirect: false,
    })

    setSubmitting(false)

    if (result?.error) {
      setError(labels.invalid)
      return
    }

    if (result?.url) {
      window.location.href = result.url
    }
  }

  return (
    <AppShell>
      <PageContainer className="flex min-h-screen items-center pt-24 sm:pt-28">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
          <SurfaceCard className="p-8 sm:p-10 lg:p-12">
            <Eyebrow>{labels.eyebrow}</Eyebrow>
            <div className="mt-8 max-w-2xl space-y-4">
              <h1 className="text-[clamp(2.4rem,5vw,4.4rem)] font-semibold leading-[0.96] tracking-[-0.06em] text-slate-950 dark:text-slate-100">
                {labels.title}
              </h1>
              <p className="max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                {labels.description}
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {labels.points.map((point) => (
                <SurfaceCard key={point} tone="soft" className="p-4">
                  <div className="h-9 w-9 rounded-[14px] border border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-white/[0.04]" />
                  <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {point}
                  </p>
                </SurfaceCard>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard tone="soft" className="p-6 sm:p-8">
            <SecondaryButton
              onClick={() => void signIn('google', { callbackUrl })}
              className="w-full"
            >
              {labels.google}
            </SecondaryButton>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                {labels.divider}
              </span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
            </div>

            <form onSubmit={handleCredentialsSignIn} className="space-y-4">
              <Field
                label={labels.email}
                type="email"
                value={email}
                onChange={setEmail}
              />
              <Field
                label={labels.password}
                type="password"
                value={password}
                onChange={setPassword}
              />

              <ActionButton type="submit" disabled={submitting} className="w-full">
                {submitting ? labels.pending : labels.submit}
              </ActionButton>
            </form>

            <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {labels.helper}
            </p>

            {providerError || error ? (
              <p className="mt-3 rounded-[16px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-400/20 dark:bg-rose-500/[0.08] dark:text-rose-300">
                {error || labels.invalid}
              </p>
            ) : null}
          </SurfaceCard>
        </div>
      </PageContainer>
    </AppShell>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string
  type: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-[16px] border border-slate-200 bg-white/90 px-4 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-400/50"
      />
    </label>
  )
}
