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

export async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      // Rate limit: exponential backoff
      if ((e as NodeJS.ErrnoException & { status?: number })?.status === 429) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000))
        continue
      }
      throw lastError
    }
  }
  throw lastError
}
