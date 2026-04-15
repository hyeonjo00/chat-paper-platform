export interface KakaoMessage {
  speaker: string
  timestamp: Date
  text: string
}

const DATE_HEADER_RE =
  /^-*\s*(\d{4})\s*\uB144\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C(?:\s+\S+)?\s*-*$/

const IOS_SPLIT_RE =
  /^(?:\[(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(\uC624\uC804|\uC624\uD6C4)\s+\d{1,2}:\d{2})\]\s*)?(\uC624\uC804|\uC624\uD6C4)\s+(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s*(.*)$/

const ANDROID_SPLIT_RE =
  /^(.+?)\s*:\s*\[(\uC624\uC804|\uC624\uD6C4)\s+(\d{1,2}):(\d{2})\]\s*(.*)$/

const INLINE_RE =
  /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\uC624\uC804|\uC624\uD6C4)\s+(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s*(.*)$/

const INLINE_BRACKET_RE =
  /^\[(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\uC624\uC804|\uC624\uD6C4)\s+(\d{1,2}):(\d{2})\]\s*\[(.+?)\]\s*(.*)$/

const SYSTEM_RE =
  /\uB2D8\uC774\s+\uB4E4\uC5B4\uC654\uC2B5\uB2C8\uB2E4|\uB2D8\uC774\s+\uB098\uAC14\uC2B5\uB2C8\uB2E4|\uB2D8\uC744\s+\uB0B4\uBCF4\uB0C8\uC2B5\uB2C8\uB2E4|\uCC44\uD305\uBC29\uC744\s+\uB098\uAC14\uC2B5\uB2C8\uB2E4|\uCE74\uCE74\uC624\uD1A1\s+\uB300\uD654\s+\uB0B4\uC6A9\uC744\s+\uB0B4\uBCF4\uB0C8\uC2B5\uB2C8\uB2E4|\uC800\uC7A5\uD55C\s+\uB0A0\uC9DC/

function toDate(
  year: number,
  month: number,
  day: number,
  ampm: string,
  hour: number,
  min: number
): Date {
  let h = hour
  if (ampm === '\uC624\uD6C4' && h !== 12) h += 12
  if (ampm === '\uC624\uC804' && h === 12) h = 0
  return new Date(year, month - 1, day, h, min)
}

function pushMessage(
  results: KakaoMessage[],
  speaker: string,
  timestamp: Date,
  text: string
) {
  results.push({
    speaker: speaker.trim(),
    timestamp,
    text: text.trim(),
  })
}

export function parseKakaoTalk(raw: string): KakaoMessage[] {
  const results: KakaoMessage[] = []
  let curYear = new Date().getFullYear()
  let curMonth = 1
  let curDay = 1

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || SYSTEM_RE.test(trimmed)) continue

    const dateHeader = trimmed.match(DATE_HEADER_RE)
    if (dateHeader) {
      curYear = Number(dateHeader[1])
      curMonth = Number(dateHeader[2])
      curDay = Number(dateHeader[3])
      continue
    }

    const inline = trimmed.match(INLINE_RE)
    if (inline) {
      pushMessage(
        results,
        inline[7],
        toDate(
          Number(inline[1]),
          Number(inline[2]),
          Number(inline[3]),
          inline[4],
          Number(inline[5]),
          Number(inline[6])
        ),
        inline[8]
      )
      continue
    }

    const inlineBracket = trimmed.match(INLINE_BRACKET_RE)
    if (inlineBracket) {
      pushMessage(
        results,
        inlineBracket[7],
        toDate(
          Number(inlineBracket[1]),
          Number(inlineBracket[2]),
          Number(inlineBracket[3]),
          inlineBracket[4],
          Number(inlineBracket[5]),
          Number(inlineBracket[6])
        ),
        inlineBracket[8]
      )
      continue
    }

    const iosSplit = trimmed.match(IOS_SPLIT_RE)
    if (iosSplit) {
      pushMessage(
        results,
        iosSplit[6],
        toDate(curYear, curMonth, curDay, iosSplit[3], Number(iosSplit[4]), Number(iosSplit[5])),
        iosSplit[7]
      )
      continue
    }

    const androidSplit = trimmed.match(ANDROID_SPLIT_RE)
    if (androidSplit) {
      pushMessage(
        results,
        androidSplit[1],
        toDate(curYear, curMonth, curDay, androidSplit[2], Number(androidSplit[3]), Number(androidSplit[4])),
        androidSplit[5]
      )
      continue
    }

    if (results.length) {
      const last = results[results.length - 1]
      last.text = `${last.text}\n${trimmed}`.trim()
    }
  }

  return results
}
