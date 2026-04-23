'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  paperId: string
  targetLang: string
  translatingLabel: string
  errorLabel: string
}

export default function PaperTranslateTrigger({
  paperId,
  targetLang,
  translatingLabel,
  errorLabel,
}: Props) {
  const router = useRouter()
  const [failed, setFailed] = useState(false)
  const didFetch = useRef(false)

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true

    fetch(`/api/papers/${paperId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLang }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok) {
          router.refresh()
        } else {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
  }, [paperId, targetLang, router])

  if (failed) {
    return (
      <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/[0.06] dark:text-amber-300">
        {errorLabel}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-white/20 dark:border-t-white/60" />
      {translatingLabel}
    </div>
  )
}
