# Chat Paper

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

**카카오톡, Instagram DM, LINE, AI 대화 로그를 계정 없이 학술 논문으로 변환하는 비동기 AI 파이프라인**

![Chat Paper 홈](docs/screenshots/home-dark.png)

---

## 소개

Chat Paper는 하나의 구체적인 문제를 해결한다. 대화 데이터에는 의미 있는 분석 신호가 담겨 있다 — 주제 변화, 감정 흐름, 발화자 역학, 커뮤니케이션 패턴. 하지만 이를 구조화되고 인용 가능한 형식으로 표면화하는 도구는 존재하지 않았다.

플랫폼은 원본 대화 내보내기 파일을 받아 서버에서 파싱·익명화하고, 장기 실행 AI 생성 작업을 큐에 넣은 뒤, 제목·초록·서론·연구 방법·결과·논의·결론이 포함된 완전한 학술 논문을 생성한다. 7가지 글쓰기 스타일을 지원한다: 심리학 논문, 커뮤니케이션 분석, 관계 역학, 사회학, 행동과학, 전산 텍스트 분석, 생물정보학.

전체 흐름은 게스트 우선이다. 계정이 필요 없다. 브라우저 범위의 세션 쿠키가 업로드와 결과를 연결한다.

---

## 스크린샷

### 랜딩

![랜딩 화면](docs/screenshots/home-dark.png)

### 업로드 플로우

![업로드 화면](docs/screenshots/upload-flow.png)

### 연구 대시보드

![결과 대시보드](docs/screenshots/result-dashboard.png)

### 논문 리더

![논문 리더](docs/screenshots/paper-reader.png)

### 모바일 프리뷰

| 랜딩 | 업로드 |
| --- | --- |
| ![모바일 랜딩](docs/screenshots/mobile-home.png) | ![모바일 업로드](docs/screenshots/mobile-upload.png) |
| 대시보드 | 리더 |
| ![모바일 대시보드](docs/screenshots/mobile-result-dashboard.png) | ![모바일 논문 리더](docs/screenshots/mobile-paper-reader.png) |

---

## 아키텍처

시스템은 비동기 파이프라인을 중심으로 설계되어 있다. 논문 생성은 대화 길이에 따라 2~8분이 소요되기 때문에 동기 HTTP로는 타임아웃이 발생한다. 큐는 수집과 처리를 분리하고, 재시도·멱등성·복구를 기본으로 제공한다.

```
클라이언트
  │
  │  HTTPS
  ▼
Next.js API 레이어  ─────────────────────────────────────────────────
  │  /api/upload        /api/analyze        /api/jobs/[id]
  │
  ├── 레이어 1: IP 프리플라이트 속도 제한 (Redis, DB 접근 전)
  ├── 레이어 2: 라우트 속도 제한 (Redis, IP + 쿠키 게스트 키)
  ├── 레이어 3: 일일 할당량 검사 (PostgreSQL, 속도 제한 통과 후)
  │
  ├── 업로드 경로:  파싱 → 익명화 → ParsedMessage 저장 → 200 OK
  │
  └── 분석 경로:   SHA-256 멱등성 키
                   Serializable 트랜잭션: 할당량 + Paper + Job 생성
                   queue.add(jobId = idempotencyKey)
                   │
  ┌────────────────┘
  │
  ▼
Redis (BullMQ Queue)
  paper-generation 큐
  속도 제한 카운터 키
  preflight:ip:* 키
  │
  │  Worker.process()
  ▼
Node.js 워커 프로세스 (Fly.io)
  processPaperJob(data, abortSignal)
  │
  ├── markJobProcessing (PENDING → PROCESSING)
  ├── DB에서 ParsedMessage 로드
  ├── chunkMessages() → 최대 3개 청크
  ├── Promise.all: analyseRelationship + summariseChunk × N
  ├── generatePaperSection × 7 (두 배치, 병렬)
  └── prisma.$transaction: Paper + Job → COMPLETED (원자적)
  │
  ▼
PostgreSQL (Prisma)
  User / Upload / ParsedMessage / Paper / Job / JobLog / Export
```

**BullMQ를 사용하는 이유:** 논문 생성은 재시도 로직이 있는 여러 개의 순차·병렬 OpenAI 호출을 포함한다. BullMQ는 Redis 기반의 영속적 작업 저장, 지수 백오프 재시도, `jobId` 기반 멱등성, 진행률 추적, 고착 작업 복구를 제공한다.

---

## 기술 스택

| 계층 | 기술 | 목적 |
|---|---|---|
| **API** | Next.js 14 App Router | HTTP 엔드포인트, 미들웨어, SSR |
| **언어** | TypeScript (strict) | 엔드투엔드 타입 안전성 |
| **스타일** | Tailwind CSS + shadcn/ui | 컴포넌트 시스템 |
| **큐** | BullMQ v5 | 비동기 작업 큐, 재시도, 멱등성 |
| **큐 브로커** | Redis (ioredis) | BullMQ 브로커 + 속도 제한 카운터 |
| **워커** | Node.js 독립 프로세스 | 장기 AI 파이프라인 실행 |
| **ORM** | Prisma | 타입 안전 PostgreSQL 접근 |
| **데이터베이스** | PostgreSQL | 상태 영속성, 트랜잭션 |
| **AI** | OpenAI GPT-4o-mini | 대화 분석 + 논문 생성 |
| **로깅** | pino | 구조화 JSON 로그 |
| **배포** | Fly.io (워커) + Vercel (API) | 독립적 확장 |

---

## 핵심 백엔드 설계

### API 레이어

**업로드 검증 (7단계 순차 게이트):**

```
1. checkIpPreflightRateLimit    Redis INCR, IP 전용, 30회/60초 — DB 접근 전
2. checkRouteRateLimit          Redis INCR, IP (8회/분) + 게스트 쿠키 (6회/분)
3. validateContentLength        헤더 검사: 누락 → 거부, 51MB 초과 → 거부
4. getGuestUser()               첫 번째 DB 접근: prisma.user.upsert
5. checkUploadQuota             DB count: 사용자당 일일 최대 20회
6. req.formData()               바디 스트리밍 시작
7. 파싱 → 익명화 → 저장
```

1~3단계를 4단계 이전에 배치하는 것이 DB DoS 방어의 핵심이다. 공격자는 두 개의 독립적인 Redis 검사를 통과하지 않고서는 `prisma.user.upsert`(쓰기 작업)를 유발할 수 없다.

**ZIP 폭탄 방어:**

```
최대 항목 수:              500개
항목당 최대 비압축 크기:   50 MB
전체 최대 비압축 크기:     100 MB (모든 항목의 누적 합산)
메타데이터 무결성:         압축 해제 전에 JSZip _data.uncompressedSize를
                           비음수 안전 정수로 검증
```

**형식 자동 감지:** `.html/.htm` → Instagram DM; `timestamp_ms` + `sender_name` 포함 `.json` → Instagram DM; 탭 구분 타임스탬프 → LINE; `*Human/*Assistant` → AI 대화; 한국어 날짜 패턴 → 카카오톡.

---

### 큐 레이어

**BullMQ 설정:**

```javascript
PAPER_JOB_OPTIONS = {
  attempts:         3,
  backoff:          { type: 'exponential', delay: 5_000 },  // 5초 → 10초 → 20초
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 500 },
  jobId:            idempotencyKey,   // SHA-256(uploadId:style:lang)
}

워커 설정:
  lockDuration:  jobTimeoutMs + 90_000   // 하드 타임아웃 위로 90초 여유
  lockRenewTime: min(2분, jobTimeoutMs / 3)
  limiter:       { max: 2, duration: 10_000 }
```

**멱등성:** `(uploadId, writingStyle, lang)`의 SHA-256 해시가 BullMQ `jobId`와 PostgreSQL `idempotencyKey` 유니크 제약 조건으로 동시에 사용된다. 중복 요청은 DB 유니크 제약에서 `P2002`를 발생시키고, 새 작업 생성 없이 기존 작업을 반환한다.

**분석 Serializable 트랜잭션:**

```
BEGIN ISOLATION LEVEL SERIALIZABLE
  동시 실행 중 작업 수 < 2 확인
  일일 작업 수 < 10 확인
  INSERT INTO papers (status = PROCESSING)
  INSERT INTO jobs   (idempotencyKey, status = PENDING)
COMMIT
→ P2034 (직렬화 실패) → 409
→ P2002 (멱등성 키 존재) → 기존 작업 반환
```

---

### 워커 레이어

**작업 생명주기:**

```
BullMQ가 큐에서 작업 가져옴
  → runWithHardDeadline(data, jobTimeoutMs)
      AbortController 생성
      setTimeout(abort, jobTimeoutMs)
      Promise.race([processPaperJob(...), 타임아웃])
  → markJobProcessing: PENDING → PROCESSING (원자적, count == 1 guard)
  → ParsedMessage 로드 (DB)
  → chunkMessages() — 슬라이딩 윈도우, 최대 3개 청크
  → Promise.all:
      analyseRelationship(signal)      병렬
      summariseChunk × N (직렬)        병렬 브랜치
  → 섹션 배치 1: title + abstract + introduction  (병렬)
  → 섹션 배치 2: methods + results + discussion + conclusion  (병렬)
  → prisma.$transaction:
      UPDATE papers WHERE status = PROCESSING → COMPLETED
      UPDATE jobs   WHERE status = PROCESSING → COMPLETED
      count ≠ 1이면 예외 발생
```

**AbortSignal 전파:** 작업 타임아웃 → `AbortController.abort()` → 각 단계 사이 `signal.aborted` 검사 → `callWithRetry`의 `parentSignal.aborted` 검사 → 요청별 컨트롤러 중단 → OpenAI SDK의 진행 중인 fetch 취소.

**청킹 알고리즘:**

```
토큰 추정:   ceil(한국어 문자 수 × 1.5 + 기타 문자 수 × 0.25)
청크 예산:   9,000 토큰 (10,000 − 1,000 시스템 프롬프트 예약)
중복:        64 토큰 (청크 경계 문맥 연속성)
최대 청크:   3개 (비용 제어 — 초과 시 가장 작은 인접 쌍 병합)
```

**진행률 추적:** 각 단계에서 `jobs.progress` 갱신: 5% → 10% → 30% → 55% → 75% → 95% → 100%.

---

### 데이터베이스 레이어

**스키마 개요:**

```
User           게스트 또는 인증 사용자 식별 정보
Upload         파일 메타데이터, 파싱 상태 → ParsedMessage, Paper, Job 소유
ParsedMessage  익명화된 메시지 (speakerId, timestamp, text)
               인덱스: (uploadId, timestamp)
Paper          7개 섹션 @db.Text, 관계 분석 필드
               상태: PROCESSING → COMPLETED | FAILED
Job            실행 제어 레코드
               idempotencyKey (유니크), status, progress 0-100
               startedAt (12분 복구 기준)
               enqueuedAt (30분 PENDING 복구 기준)
               attempts / maxAttempts
JobLog         추가 전용 구조화 로그, 7일 후 자동 삭제
Export         PDF / DOCX 메타데이터
```

**트랜잭션 일관성:** 모든 다중 엔티티 상태 전이는 양쪽에 상태 guard가 있는 `prisma.$transaction`을 사용한다:

```sql
UPDATE papers SET status = 'COMPLETED' WHERE id = ? AND status = 'PROCESSING'
UPDATE jobs   SET status = 'COMPLETED' WHERE id = ? AND status = 'PROCESSING'
-- count ≠ 1이면 예외 발생
-- 복구된 작업이 재실행되는 동안 원래 실행이 완료 처리를 시도할 때
-- 이중 완료를 방지한다
```

---

## 처리 흐름

전체 단계별 파이프라인:

```
1.  사용자가 파일 업로드 (POST /api/upload)
2.  IP 프리플라이트 → 라우트 속도 제한 → Content-Length 검사
3.  게스트 사용자 upsert (첫 번째 DB 쓰기)
4.  일일 업로드 할당량 검사
5.  파일 파싱: 카카오톡 / Instagram / LINE / AI 대화
6.  메시지 익명화 (개인정보 패턴 치환)
7.  ParsedMessage DB 저장
8.  사용자가 uploadId + style + lang으로 POST /api/analyze 호출
9.  IP 프리플라이트 → 라우트 속도 제한
10. 게스트 사용자 로드
11. SHA-256 멱등성 키 도출
12. Serializable 트랜잭션: 할당량 검사 + Paper 생성 + Job 생성
13. Redis에 jobId = idempotencyKey로 작업 큐 진입
14. 워커가 BullMQ 큐에서 작업 가져옴
15. DB에서 메시지 로드, 최대 3개 토큰 윈도우로 청킹
16. 병렬: OpenAI를 통한 관계 분석 + 청크 요약
17. OpenAI를 통한 논문 섹션 생성 (두 배치 병렬)
18. 원자적 트랜잭션: Paper + Job을 COMPLETED로 표시
19. 클라이언트가 GET /api/jobs/[jobId] 폴링 → 완료 시 paperId 수신
20. 학술 리더에서 논문 렌더링, 내보내기 옵션 제공
```

---

## 신뢰성 및 안전성

### 재시도 및 백오프

```
최대 재시도:      5회
요청별 타임아웃:  90초 (AbortController)

재시도 대상:  HTTP 429, HTTP 5xx, ECONNRESET, ETIMEDOUT,
              ENOTFOUND, "fetch failed", "network", "socket", AbortError

백오프:
  429:   "try again in Xs" 파싱 → X × 1000 + 500ms
  기타:  1000 × 2^attempt + random(0~1000)ms

재시도 불가: 4xx 클라이언트 오류 (즉시 throw)
```

`sleep()` 함수는 중단 가능하다. 백오프 대기 중에 부모 AbortSignal이 발생하면 지연 만료를 기다리지 않고 즉시 중단 오류를 발생시킨다.

### 고착 작업 복구 (5분마다 실행)

**PROCESSING 경로 (12분 기준):**

```
status = PROCESSING AND startedAt < now - 12분인 작업 각각에 대해:
  시도 횟수 소진 시:
    원자적: Job → FAILED, Paper → FAILED
  시도 횟수 남은 경우:
    bullJobId의 Redis 상태 확인
    RUNNABLE (active/waiting/delayed)이면: 건너뜀 (실행 중)
    TERMINAL (failed/completed)이면: 제거 후 재큐
    DB 낙관적 guard: updateMany WHERE status = PROCESSING
    count ≠ 1이면: 큐 항목 제거 (경쟁 조건 롤백)
```

**PENDING 경로 (30분 기준):** Redis 항목이 소실된 작업을 재큐한다. BullMQ `jobId` 중복 방지로 Redis 항목이 여전히 존재하더라도 이중 실행을 방지한다.

**로그 정리:** 각 복구 sweep에서 7일 이상 된 `jobLog` 행을 삭제한다.

### 그레이스풀 셧다운

```
SHUTDOWN_TIMEOUT_MS = 4,000ms  (Fly.io 기본 5초 SIGKILL보다 1초 여유)

SIGTERM → handleSignal 래퍼 (거부 포착)
  → shuttingDown = true (멱등성 가드)
  → clearInterval(recoveryTimer)
  → Promise.race([worker.close(), 4초 타임아웃])
  → process.exit(0)
```

---

## 보안 및 비용 제어

### 다단계 속도 제한

```
레이어 1 — IP 프리플라이트 (Redis Lua, DB 접근 전):
  키:   preflight:ip:{sha256(ip)[0:32]}
  한도: 30회 / 60초 per IP
  동작: 페일-클로즈 (Redis 오류 → 429)

레이어 2 — 라우트 수준 (Redis Lua, IP + 쿠키 게스트 키):
  업로드:  IP 8회/분, 게스트 6회/분
  분석:    IP 6회/분, 게스트 4회/분
  참고:    게스트 키는 쿠키에서 읽음 — DB 접근 없음

레이어 3 — 일일 할당량 (PostgreSQL, 게스트 생성 후):
  업로드: 일일 20회
  작업:   동시 ≤ 2개, 일일 ≤ 10개 (Serializable 트랜잭션 내부에서 강제)
```

**Lua 원자성:** INCR과 EXPIRE를 단일 Lua 스크립트로 실행하여, 두 명령 사이의 크래시로 인해 TTL 없는 카운터 키가 남아 해당 키를 영구 차단하는 버그를 방지한다.

### 업로드 제한

- 파일 크기: 최대 50 MB
- ZIP 항목 수: 최대 500개
- ZIP 전체 비압축 크기: 최대 100 MB
- 허용 확장자: `.txt`, `.md`, `.json`, `.html`, `.htm`, `.zip`

### OpenAI 비용 제어

- 모델: `gpt-4o-mini` 전용
- 청크당 최대 토큰: 9,000
- 작업당 최대 청크: 3개 (최대 ~11회 LLM 호출)
- 일일 작업 할당량을 Serializable 트랜잭션 내부에서 강제 (병렬 우회 불가)

---

## 프로젝트 구조

```
chat-paper-platform/
│
├── src/
│   ├── app/                    Next.js App Router 페이지 및 API 라우트
│   │   ├── api/
│   │   │   ├── upload/         파일 수집, 파싱, 익명화
│   │   │   ├── analyze/        작업 생성, 멱등성, 큐 진입
│   │   │   ├── jobs/[jobId]/   작업 상태 폴링, 소유권 검사
│   │   │   ├── papers/         논문 조회 및 생성 트리거
│   │   │   └── results/        대시보드용 결과 집계
│   │   ├── upload/             업로드 페이지 (클라이언트)
│   │   ├── result/             연구 대시보드 (클라이언트)
│   │   └── paper/[paperId]/    학술 논문 리더 (클라이언트)
│   │
│   ├── components/             재사용 가능한 UI 컴포넌트 (shadcn/ui 기반)
│   ├── lib/
│   │   ├── api/                응답 헬퍼, 속도 제한
│   │   ├── auth/               게스트 세션 쿠키 로직
│   │   ├── db/                 Prisma 클라이언트 싱글톤
│   │   ├── nlp/                청커, 언어 감지기
│   │   ├── openai/             callWithRetry, promptPipeline
│   │   ├── parsers/            카카오톡, Instagram, LINE, AI 파서
│   │   └── privacy/            개인정보 익명화
│   └── types/                  공유 TypeScript 타입
│
├── server/
│   ├── db/                     워커 프로세스용 Prisma 클라이언트
│   ├── lib/                    로거 (pino), 환경변수 로더
│   ├── queue/                  BullMQ 큐 정의, Redis 연결
│   ├── services/               jobService (DB 상태 전이)
│   └── worker/
│       ├── index.ts            워커 진입점, 셧다운 처리
│       ├── processor.ts        processPaperJob 파이프라인
│       └── recovery.ts         고착 작업 복구, 로그 정리
│
├── prisma/
│   └── schema.prisma           전체 데이터 모델
│
└── docs/
    ├── chat-paper-ai-technical-whitepaper-en.md
    └── chat-paper-ai-technical-whitepaper-ko.md
```

---

## 기술 백서

알고리즘 의사코드, 다이어그램 설명, 트랜잭션 설계, 신뢰성 엔지니어링을 포함한 전체 시스템 설계 문서:

- [기술 백서 (한국어)](docs/chat-paper-ai-technical-whitepaper-ko.md)
- [Technical Whitepaper (English)](docs/chat-paper-ai-technical-whitepaper-en.md)

---

## 배포

### 워커 — Fly.io

워커 프로세스는 Next.js 애플리케이션과 독립적으로 Fly.io에서 실행된다.

```toml
# fly.toml
[processes]
  worker = "node dist/server/worker/index.js"

[[vm]]
  memory = "512mb"
```

워커 TypeScript 빌드는 별도의 `server/tsconfig.json`을 사용한다. `baseUrl: ".."` 및 `paths: { "@/*": ["src/*"] }` 설정으로 `@/lib/openai`, `@/types` 경로가 Next.js 컴파일러 없이도 독립 Node.js 빌드에서 올바르게 해석된다.

### API — Vercel (또는 Fly.io)

Next.js 애플리케이션은 Vercel 또는 Node.js 호스트에 배포된다. 두 프로세스는 동일한 PostgreSQL과 Redis 인스턴스를 공유한다.

### 환경변수

```bash
OPENAI_API_KEY=           # OpenAI API 키
DATABASE_URL=             # PostgreSQL 연결 문자열 (풀링 포함)
REDIS_URL=                # Redis 연결 문자열
WORKER_CONCURRENCY=       # 워커 인스턴스당 동시 작업 수 (기본값: 2)
JOB_TIMEOUT_MS=           # 하드 작업 타임아웃 (ms, 예: 600000 = 10분)
NEXTAUTH_SECRET=          # NextAuth 시크릿 (게스트 전용 흐름에서도 필요)
NEXTAUTH_URL=             # Next.js 앱 공개 URL
```

### 로컬 실행

```bash
npm install
cp .env.example .env.local
# .env.local에 DATABASE_URL, REDIS_URL, OPENAI_API_KEY 입력
npm run db:generate
npm run db:push
npm run dev
# 별도 터미널에서:
npm run build:worker
npm run worker
```

[http://localhost:3000](http://localhost:3000)을 열면 된다.

### 주요 라우트

| 라우트 | 목적 |
|---|---|
| `/` | 랜딩 페이지 |
| `/upload` | 업로드 및 분석 시작 |
| `/result?paperId=...` | 연구 대시보드 |
| `/paper/[paperId]` | 학술 논문 리더 |

---

## 한계

| 영역 | 현재 상태 |
|---|---|
| 신규 방문자 속도 제한 | 쿠키 없는 요청이 빈 문자열 Redis 버킷을 공유 — 동시 신규 방문자가 서로의 게스트 속도 제한을 소비 가능 |
| 청크 상한 | 대화 길이에 무관하게 최대 3개 — 매우 긴 대화는 정보 손실 가능 |
| 단일 LLM 모델 | `gpt-4o-mini` 전용 — 모델 선택 없음, 폴백 없음 |
| 워커 확장 | 단일 워커 인스턴스 — 수평 확장 미지원 |
| 익명화 | 패턴 기반 개인정보 치환 — 한국어 이름·주소에 대한 개체명 인식 없음 |
| 내보내기 캐싱 없음 | 매 요청마다 PDF/DOCX 재생성 |

---

## 향후 개선

- 게스트 쿠키 없을 때 IP 주소로 폴백 (공유 속도 제한 버킷 해소)
- 매우 긴 대화를 위한 동적 청크 수
- 모델 선택 (Claude, GPT-4o) + 비용 등급 UI
- 수평 BullMQ 워커 클러스터
- 익명화 품질 향상을 위한 한국어 NER
- 오브젝트 스토리지 기반 내보내기 캐싱
- 논문 이력 및 데이터 보존 제어가 있는 사용자 계정
- 작업 처리량·오류율·지연 백분위수 관측성 대시보드

---

## 이 프로젝트가 중요한 이유

Chat Paper는 주말 AI 데모를 넘어선 프로덕션 패턴을 보여준다.

**비동기 파이프라인 설계:** 시스템은 동기 HTTP 레이어와 장기 실행 처리 레이어를 영속적 큐로 올바르게 분리한다. 작업 상태는 모든 장애 모드(타임아웃, 크래시, Redis 장애, 부분 완료)에 대한 복구를 갖춘 PostgreSQL 기반 상태 기계를 통해 원자적으로 추적된다.

**보안 우선 API 설계:** 속도 제한이 계층화되어 있다. Redis 전용 IP 프리플라이트 검사가 DB 접근 전에 실행되어 비인증 트래픽의 DB DoS를 방지한다. 3계층 아키텍처(프리플라이트 → 라우트 제한 → 할당량 트랜잭션)로 각 방어가 독립적이다.

**정확히 한 번 실행 보장:** SHA-256 멱등성 키를 BullMQ `jobId`와 PostgreSQL 유니크 제약 조건으로 동시에 사용하고, Serializable 격리 트랜잭션을 결합함으로써 중복 API 호출이 동시 부하 하에서도 정확히 하나의 논문만 생성하도록 보장한다.

**우아한 장애 처리:** 모든 장애 경로에 정의된 결과가 있다. 고착 작업은 두 단계(PROCESSING, PENDING)로 복구되고, 원자적 트랜잭션이 부분 쓰기를 방지하며, 워커는 Fly.io의 SIGKILL 윈도우 내에서 셧다운된다.

**한국어 우선 국제화:** 플랫폼은 카카오톡의 한국어 날짜 형식, LINE의 탭 구분 내보내기, Instagram의 JSON 스키마를 AI 대화 로그와 함께 네이티브로 처리한다 — 채팅 형식 파싱을 위한 서드파티 라이브러리 없이.
