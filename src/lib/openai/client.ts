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

const OPENAI_REQUEST_TIMEOUT_MS = 90_000

function isAbortLike(error: Error) {
  return error.name === 'AbortError'
}

function retryDelayMs(attempt: number, error: Error, isRateLimit: boolean) {
  if (isRateLimit) {
    const match = error.message.match(/try again in ([0-9.]+)s/i)
    if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500
  }

  return 1_000 * Math.pow(2, attempt) + Math.random() * 1_000
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Job aborted'))
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('Job aborted'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  maxRetries = 5,
  parentSignal?: AbortSignal,
): Promise<T> {
  let lastError: Error | undefined

  for (let i = 0; i < maxRetries; i++) {
    if (parentSignal?.aborted) throw new Error('Job aborted')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS)
    const onParentAbort = () => controller.abort()
    parentSignal?.addEventListener('abort', onParentAbort, { once: true })

    try {
      return await fn(controller.signal)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      if (parentSignal?.aborted) throw new Error('Job aborted')

      const status = (e as { status?: number })?.status
      const code = (e as NodeJS.ErrnoException)?.code
      const msg = lastError.message

      const isRateLimit = status === 429
      const isServerError = typeof status === 'number' && status >= 500
      const isRequestTimeout = isAbortLike(lastError)
      const isNetworkError =
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('socket')

      if (isRateLimit || isServerError || isNetworkError || isRequestTimeout) {
        if (i === maxRetries - 1) throw lastError

        const backoffMs = retryDelayMs(i, lastError, isRateLimit)
        console.warn(
          `[openai] retryable error (status=${status ?? code ?? lastError.name}), ` +
            `waiting ${Math.round(backoffMs)}ms (attempt ${i + 1}/${maxRetries})`,
        )
        await sleep(backoffMs, parentSignal)
        continue
      }

      throw lastError
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    }
  }

  throw lastError
}
