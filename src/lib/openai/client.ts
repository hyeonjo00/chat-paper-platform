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

export async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if ((e as NodeJS.ErrnoException & { status?: number })?.status === 429) {
        // Retry-After 헤더에서 대기 시간 읽기, 없으면 지수 백오프
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
    }
  }
  throw lastError
}
