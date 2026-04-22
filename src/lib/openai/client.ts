import OpenAI from 'openai'

let _openai: OpenAI | undefined

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

/** @deprecated use getOpenAI() */
export const openai = new Proxy({} as OpenAI, {
  get(_t, prop) {
    return (getOpenAI() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Per-request timeout: if OpenAI doesn't respond within this window the request
// is aborted and retried (or ultimately fails the job via BullMQ timeout).
const OPENAI_REQUEST_TIMEOUT_MS = 90_000 // 90 s

export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < maxRetries; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS)
    try {
      return await fn(controller.signal)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      if (lastError.name === 'AbortError' || lastError.message.includes('aborted')) {
        console.warn(`[openai] request timed out after ${OPENAI_REQUEST_TIMEOUT_MS}ms (attempt ${i + 1}/${maxRetries})`)
        // treat timeout as retryable — fall through to next iteration
        continue
      }

      if ((e as NodeJS.ErrnoException & { status?: number })?.status === 429) {
        const retryAfterMs = (() => {
          const msg = lastError.message ?? ''
          const match = msg.match(/try again in ([0-9.]+)s/i)
          if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500
          return Math.pow(2, i) * 2000
        })()
        console.log(`[openai] rate limited, waiting ${retryAfterMs}ms (attempt ${i + 1}/${maxRetries})`)
        await new Promise(r => setTimeout(r, retryAfterMs))
        continue
      }

      throw lastError
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}
