export interface KakaoMessage {
  speaker: string
  timestamp: Date
  text: string
}

// Date header lines (no message content)
// e.g. "2024년 1월 15일 월요일"  or  "--------------- 2024년 1월 15일 월요일 ---------------"
const DATE_HEADER_RE = /(\d{4})년 (\d{1,2})월 (\d{1,2})일/

// iOS message line: "오전 9:05, 홍길동 : 메시지"
const IOS_MSG_RE = /^(오전|오후) (\d{1,2}):(\d{2}), (.+?) : (.+)$/

// Android message line: "홍길동 : [오전 9:05] 메시지"
const ANDROID_MSG_RE = /^(.+?) : \[(오전|오후) (\d{1,2}):(\d{2})\] (.+)$/

// Full inline format (older exports): "[2024년 1월 5일 오후 3:25] [홍길동] 메시지"
const INLINE_IOS_RE = /^\[(\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2})\] \[(.+?)\] (.+)$/
// Full inline Android: "2024년 1월 5일 오후 3:25, 홍길동 : 메시지"
const INLINE_AND_RE = /^(\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}), (.+?) : (.+)$/

const SKIP_RE = /님이 들어왔습니다|님이 나갔습니다|님을 내보냈습니다|채팅방을 나갔습니다|카카오톡 대화/

function toDate(year: number, month: number, day: number, ampm: string, hour: number, min: number): Date {
  let h = hour
  if (ampm === '오후' && h !== 12) h += 12
  if (ampm === '오전' && h === 12) h = 0
  return new Date(year, month - 1, day, h, min)
}

function parseKoreanDatetime(raw: string): Date | null {
  const m = raw.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})/)
  if (!m) return null
  return toDate(+m[1], +m[2], +m[3], m[4], +m[5], +m[6])
}

export function parseKakaoTalk(raw: string): KakaoMessage[] {
  const results: KakaoMessage[] = []
  let curYear = new Date().getFullYear()
  let curMonth = 1
  let curDay = 1

  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || SKIP_RE.test(t)) continue

    // Date header — update current date context
    const dh = t.match(DATE_HEADER_RE)
    if (dh && !IOS_MSG_RE.test(t) && !ANDROID_MSG_RE.test(t)) {
      curYear = +dh[1]; curMonth = +dh[2]; curDay = +dh[3]
      continue
    }

    // iOS split format: "오전 9:05, 홍길동 : 메시지"
    const ios = t.match(IOS_MSG_RE)
    if (ios) {
      const [, ampm, hStr, mStr, speaker, text] = ios
      const timestamp = toDate(curYear, curMonth, curDay, ampm, +hStr, +mStr)
      results.push({ speaker: speaker.trim(), timestamp, text: text.trim() })
      continue
    }

    // Android split format: "홍길동 : [오전 9:05] 메시지"
    const and = t.match(ANDROID_MSG_RE)
    if (and) {
      const [, speaker, ampm, hStr, mStr, text] = and
      const timestamp = toDate(curYear, curMonth, curDay, ampm, +hStr, +mStr)
      results.push({ speaker: speaker.trim(), timestamp, text: text.trim() })
      continue
    }

    // Full inline iOS: "[2024년 1월 5일 오후 3:25] [홍길동] 메시지"
    const inlIos = t.match(INLINE_IOS_RE)
    if (inlIos) {
      const [, rawDate, speaker, text] = inlIos
      const timestamp = parseKoreanDatetime(rawDate)
      if (timestamp) results.push({ speaker: speaker.trim(), timestamp, text: text.trim() })
      continue
    }

    // Full inline Android: "2024년 1월 5일 오후 3:25, 홍길동 : 메시지"
    const inlAnd = t.match(INLINE_AND_RE)
    if (inlAnd) {
      const [, rawDate, speaker, text] = inlAnd
      const timestamp = parseKoreanDatetime(rawDate)
      if (timestamp) results.push({ speaker: speaker.trim(), timestamp, text: text.trim() })
      continue
    }
  }

  return results
}
