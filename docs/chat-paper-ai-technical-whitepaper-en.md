---

# Chat Paper AI Technical Whitepaper

**Transforming Conversational Data into Structured Academic Research**

---

**Author:** Hyeonjo Kim  
**Project:** Chat Paper AI  
**Version:** 2.0  
**Date:** April 2025  
**Repository:** [github.com/hyeonjo00/chat-paper-platform](https://github.com/hyeonjo00/chat-paper-platform)  
**Category:** Korean-first AI SaaS · Conversation Analysis · Academic Paper Generation  

---

\newpage

## Table of Contents

1. [Abstract](#abstract)
2. [Product Problem](#1-product-problem)
3. [System Goals](#2-system-goals)
4. [System Architecture](#3-system-architecture)
   - 3.1 Layered Overview
   - 3.2 Component Responsibilities
   - 3.3 Dual Redis Connection Architecture
5. [Backend Deep Dive](#4-backend-deep-dive)
   - 4.1 Upload API (`/api/upload`)
   - 4.2 Analyze API (`/api/analyze`)
   - 4.3 Job Status API (`/api/jobs/[jobId]`)
6. [Queue Architecture](#5-queue-architecture)
   - 5.1 BullMQ Design
   - 5.2 Idempotency Flow
7. [Worker Execution Flow](#6-worker-execution-flow)
   - 6.1 Job Lifecycle
   - 6.2 Abort Signal Propagation Chain
   - 6.3 Progress Tracking
8. [Database Schema Design](#7-database-schema-design)
   - 7.1 Core Entities
   - 7.2 Transaction Consistency Guarantees
9. [Reliability Engineering](#8-reliability-engineering)
   - 8.1 Worker Hard Timeout
   - 8.2 Stuck Job Recovery
   - 8.3 Graceful Shutdown
10. [Security Architecture](#9-security-architecture)
    - 9.1 Multi-Tier Rate Limiting
    - 9.2 OpenAI Cost Controls
11. [OpenAI Pipeline Architecture](#10-openai-pipeline-architecture)
    - 10.1 Prompt Pipeline Layers
    - 10.2 Writing Style Modifiers
    - 10.3 Section Generation Batching
12. [Core Algorithms](#11-core-algorithms)
    - 11.1 Chunking Algorithm
    - 11.2 Retry and Exponential Backoff
    - 11.3 Idempotency Control
    - 11.4 Stuck Job Recovery
    - 11.5 Rate Limiting Algorithm
13. [Deployment Architecture](#12-deployment-architecture)
    - 12.1 Fly.io Multi-Process Deployment
    - 12.2 TypeScript Build Configuration
    - 12.3 Required Environment Variables
14. [Performance and Scalability](#13-performance-and-scalability)
15. [Limitations and Future Work](#14-limitations-and-future-work)
16. [System Diagrams](#15-system-diagrams)
17. [Appendix: Technology Stack Summary](#appendix-technology-stack-summary)

---

\newpage

## Abstract

Chat Paper AI is a **Korean-first AI SaaS platform** that automatically transforms KakaoTalk exports, Instagram DM archives, LINE chat logs, and AI conversation transcripts into structured academic papers. The system is composed of a Next.js API layer, a Redis-backed BullMQ asynchronous job queue, a standalone Node.js worker process, a Prisma/PostgreSQL persistence layer, and an OpenAI GPT-4o-mini generation pipeline.

Three primary engineering challenges are addressed:

- **First:** A preprocessing pipeline that parses and anonymizes unstructured conversational data regardless of source platform, language, or export format.
- **Second:** Exactly-once execution guarantees for long-running LLM jobs (up to 10 minutes) through deterministic idempotency keys and Serializable database transactions.
- **Third:** A multi-tier rate limiting architecture that prevents database denial-of-service in a guest-based usage model by ensuring all Redis checks complete before any database write occurs.

The output is not a raw AI text response. It is a **research-style document** organized into title, abstract, introduction, methods, results, discussion, and conclusion — generated in one of seven academic writing styles, in Korean, English, or Japanese.

---

\newpage

## 1. Product Problem

Conversational data contains patterns that are difficult to evaluate manually: topic shifts, emotional tone, relationship dynamics, speaker roles, and communication habits. Existing chat backup and export tools preserve raw dialogue but do not convert it into a structured analytical artifact.

Chat Paper AI addresses this gap by transforming informal conversations into structured academic drafts. The target users range from researchers and counselors who need systematic analysis, to individuals seeking to reflect on significant relationships through an objective, document-based lens.

---

\newpage

## 2. System Goals

- Provide a **Korean-first** upload and analysis experience supporting KakaoTalk, Instagram DM, LINE, and AI conversation exports.
- Preserve a **guest-first workflow** without mandatory account creation.
- Split long conversation logs into **token-bounded chunks** before AI generation to stay within model context limits.
- Avoid permanent raw file storage; **anonymize parsed message content** before persistence.
- Present results in a **research dashboard** and journal-grade paper reader.
- Enforce **multi-tier Redis rate limiting** before any database access to prevent DB DoS.
- Use **BullMQ asynchronous queuing** for reliable long-running job execution.

---

\newpage

## 3. System Architecture

### 3.1 Layered Overview

The system is organized into **five vertical layers**, each with a clearly bounded responsibility.

![System Layered Overview](./docs/diagrams/system-layered-overview.png)

```
┌─────────────────────────────────────────────────────┐
│                    Client (Browser)                  │
└─────────────────┬───────────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────────┐
│              API Layer (Next.js App Router)           │
│  /api/upload   /api/analyze   /api/jobs/[id]         │
│  /api/papers/[id]   /api/results/[id]                │
└──────┬────────────────────────────┬─────────────────┘
       │ prisma.$transaction        │ queue.add(jobId)
┌──────▼──────────┐    ┌───────────▼─────────────────┐
│   PostgreSQL DB  │    │     Redis (BullMQ Queue)      │
│  User / Upload   │    │  paper-generation queue       │
│  ParsedMessage   │    │  rate-limit counters          │
│  Paper / Job     │    │  preflight:ip:* keys          │
│  JobLog / Export │    └───────────┬─────────────────┘
└──────▲───────────┘               │ Worker.process()
       │               ┌───────────▼─────────────────┐
       │               │   Worker Process (Node.js)   │
       │               │  processPaperJob()           │
       └───────────────┤  chunker → promptPipeline    │
         atomic save   │  → OpenAI GPT-4o-mini        │
                       └─────────────────────────────┘
```

---

### 3.2 Component Responsibilities

| Component | Responsibility | Technology |
|---|---|---|
| API Layer | Request validation, rate limiting, queue entry | Next.js 14 App Router |
| Redis | Rate-limit counters, job queue broker | ioredis + BullMQ v5 |
| Worker | LLM pipeline execution, result persistence | Node.js + BullMQ Worker |
| PostgreSQL | State persistence, transactional consistency | Prisma ORM |
| OpenAI | Language analysis, paper section generation | GPT-4o-mini |

---

### 3.3 Dual Redis Connection Architecture

The API layer and the worker intentionally use **different ioredis connection configurations**:

- **API connection** (`enableOfflineQueue: false`): Fails immediately on Redis outage, returning a clear error to the caller. Prevents requests from queueing against an unavailable broker, which would silently delay responses.
- **Worker connection** (`enableOfflineQueue: true`): Buffers operations and reconnects automatically after transient Redis failures. Preserves job processing continuity through brief network interruptions.

Both connections share a retry strategy capped at **5 attempts** with a maximum **3,000ms delay**, preventing indefinite reconnection loops.

> **Design Decision:**  
> Splitting API and Worker connections by `enableOfflineQueue` is the core availability trade-off. The API must fail fast so the user sees an error immediately; the Worker must tolerate brief outages so in-flight jobs are not lost.

---

\newpage

## 4. Backend Deep Dive

### 4.1 Upload API (`/api/upload`)

The upload endpoint enforces **seven sequential validation gates**. The critical invariant is that **no database access occurs until both Redis rate-limit checks have passed**.

**Execution order:**

```
Step 1: checkIpPreflightRateLimit(req)
        → Lua INCR on preflight:ip:{sha256(ip)[0:32]}
        → Limit: 30 req / 60 seconds per IP
        → Fail-closed: Redis error returns 429

Step 2: cookieGuestKey = req.cookies.get('chatpaper_guest')?.value ?? ''
        → Synchronous cookie read — zero DB cost
        checkRouteRateLimit('upload', ip, cookieGuestKey)
        → Two Lua INCRs: IP (8/min) + guest (6/min)

Step 3: validateContentLength(req)
        → Rejects missing Content-Length header
        → Rejects non-positive or non-finite values
        → Rejects values > 51 MB (50 MB + 1 MB tolerance)

Step 4: getGuestUser()
        → prisma.user.upsert — FIRST database access
        → Creates guest user record if none exists

Step 5: checkUploadQuota(userId)
        → prisma.upload.count WHERE uploadedAt >= day start
        → Limit: 20 uploads / day

Step 6: req.formData()
        → Begin body streaming only after all validation passes

Step 7: File parsing and database write
```

> **Important:**  
> This ordering is the primary defense against DB DoS. An attacker can reach the `prisma.user.upsert` only after clearing both Redis checks, limiting database write throughput to at most **30 records per minute per IP**.

---

**ZIP safety architecture:**

ZIP uploads implement defense-in-depth against zip-bomb attacks.

```
Maximum entry count:              500
Maximum per-entry uncompressed:   50 MB
Maximum total uncompressed:       100 MB (cumulative across all entries)
Metadata integrity check:         _data.compressedSize and .uncompressedSize
                                  validated as non-negative safe integers
                                  before any decompression begins
```

The platform reads JSZip's internal `_data` metadata to compute the total uncompressed budget before extracting any file content. If metadata is absent or structurally invalid (as can occur in crafted ZIP archives), the request is rejected immediately with `UploadValidationError`, which maps to **HTTP 422** — not 500 — so the error is classified correctly by monitoring systems.

---

**Format auto-detection:**

The parser is selected deterministically from file extension and content pattern matching:

```
.html / .htm                             → Instagram DM parser
.json containing "timestamp_ms"
  and "sender_name"                      → Instagram DM parser (JSON variant)
Line matching /^\d{1,2}:\d{2}\t/        → LINE parser
Line matching *Human/*User/*Assistant   → AI conversation parser
Date pattern \d{4}년 \d{1,2}월          → KakaoTalk parser
Default fallback                         → KakaoTalk parser
```

---

### 4.2 Analyze API (`/api/analyze`)

The analyze endpoint is both the **queue entry point** and the **idempotency enforcement layer**.

**Idempotency key derivation:**

```javascript
idempotencyKey = crypto
  .createHash('sha256')
  .update(`${uploadId}:${writingStyle}:${lang}`)
  .digest('hex')
```

> **Key Idea:**  
> This key is deterministic: the same upload with the same style and language always produces the same key. It is used simultaneously as the BullMQ `jobId` (Redis-level deduplication) and the PostgreSQL `idempotencyKey` unique constraint (DB-level deduplication), making duplicate job creation **impossible at both storage layers**.

**Serializable transaction design:**

```
BEGIN ISOLATION LEVEL SERIALIZABLE
  (maxWait: 5,000ms, timeout: 30,000ms)

  Count concurrent PENDING + PROCESSING jobs for userId
  Count daily jobs since 00:00 for userId
  → Throw QuotaExceededError if either limit exceeded

  INSERT INTO papers (status: PROCESSING)
  INSERT INTO jobs (idempotencyKey, status: PENDING)

COMMIT
```

Serializable isolation ensures that two concurrent requests for the same user cannot both pass the quota check and create duplicate records. Three error paths are explicitly handled downstream:

- `P2034` (serialization failure) → **409 Conflict** (client should retry)
- `P2002` (unique constraint violation on `idempotencyKey`) → fetch and return the existing job
- `QuotaExceededError` → **429** with a user-facing Korean error message

**Enqueue failure recovery:**

If the Redis queue is unavailable after the transaction commits, both the Job and Paper are **atomically rolled back** to `FAILED` in a second transaction. This prevents orphaned `PROCESSING` records that would otherwise block future requests until the recovery sweep runs.

---

### 4.3 Job Status API (`/api/jobs/[jobId]`)

Ownership verification is fused with the status query in a **single database roundtrip**. `getJobStatus()` selects `userId` alongside all status fields, so the route handler can compare the returned `userId` against the authenticated guest without issuing a separate authorization query.

---

\newpage

## 5. Queue Architecture

### 5.1 BullMQ Design

```javascript
// Options applied at enqueue time
PAPER_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },  // 5s → 10s → 20s
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 500 },
  jobId: idempotencyKey,   // BullMQ deduplication key
}

// Worker configuration
Worker({
  concurrency:   env.workerConcurrency,
  lockDuration:  env.jobTimeoutMs + 90_000,  // 90s buffer above hard deadline
  lockRenewTime: Math.min(2 * 60_000, Math.floor(env.jobTimeoutMs / 3)),
  limiter:       { max: 2, duration: 10_000 }, // 2 jobs per 10 seconds globally
})
```

> **Design Decision:**  
> The `lockDuration` is set **90 seconds above the hard job timeout**. This guarantees the BullMQ lock does not expire while the worker is still actively processing, which would cause a second worker to pick up the same job and execute it concurrently.

---

### 5.2 Idempotency Flow

```
Client POST /api/analyze(uploadId, style, lang)
  ↓
SHA-256(uploadId:style:lang) = idempotencyKey
  ↓
prisma.$transaction(Serializable)
  ├─ P2002 (duplicate key)     → return existing job  (idempotent)
  ├─ P2034 (serialization)     → 409 (retry-able)
  └─ success                   → Paper created, Job created
  ↓
queue.add('generate', payload, { jobId: idempotencyKey })
  ├─ BullMQ: same jobId exists → no-op               (idempotent)
  └─ success                   → job enqueued
```

---

\newpage

## 6. Worker Execution Flow

### 6.1 Job Lifecycle

```
BullMQ dequeues job from Redis
  ↓
runWithHardDeadline(data, jobTimeoutMs)
  AbortController created
  setTimeout(controller.abort, jobTimeoutMs)
  ↓
processPaperJob(data, controller.signal)
  ↓
  markJobProcessing(jobId)     [DB: PENDING → PROCESSING, atomic]
    if count != 1: return      (job already taken by another worker)
  ↓
  Load ParsedMessages          [DB read, ordered by timestamp]
  ↓
  chunkMessages()              [CPU: token estimation + sliding window]
  ↓
  Promise.all([
    analyseRelationship(signal)          [OpenAI, up to 5 retries]
    sequential chunk summarization       [OpenAI × N, serial, signal]
  ])
  ↓
  Build analysisContext JSON
  ↓
  Batch 1 parallel generation  [title + abstract + introduction]
  ↓
  Batch 2 parallel generation  [methods + results + discussion + conclusion]
  ↓
  prisma.$transaction()        [DB: Paper PROCESSING→COMPLETED
                                    Job  PROCESSING→COMPLETED]
    WHERE status='PROCESSING' guards on both updates
    Throws if either count != 1
```

---

### 6.2 Abort Signal Propagation Chain

```
Job timeout (setTimeout fires)
  → AbortController.abort()
    → processPaperJob: signal.aborted checked between each step
    → callWithRetry: parentSignal.aborted checked at loop start
    → per-request AbortController: linked via addEventListener
      → OpenAI SDK: signal passed to chat.completions.create()
        → In-flight HTTP request cancelled
```

> **Algorithm Insight:**  
> This **four-level propagation chain** ensures that when a job times out, any in-flight OpenAI HTTP requests are cancelled within milliseconds, rather than waiting for the 90-second per-request timeout to expire naturally.

---

### 6.3 Progress Tracking

The `jobs.progress` column is updated at each pipeline stage:

```
START:                5%
MESSAGES_LOADED:     10%
RELATIONSHIP_DONE:   30%
CHUNKS_SUMMARISED:   55%
SECTIONS_BATCH1:     75%
SECTIONS_BATCH2:     95%
COMPLETED:          100%
```

This allows the frontend to display a meaningful progress bar for long-running jobs without polling the OpenAI API directly.

---

\newpage

## 7. Database Schema Design

### 7.1 Core Entities

**User:** Guest users are created with the email convention `{uuid}@guest.chatpaper.local`. The `upsert` pattern makes guest creation idempotent — repeated calls with the same cookie produce the same user record without duplicates.

**Upload:** Stores source file metadata, parse status, and links to all derived artifacts (ParsedMessages, Papers, Jobs). Cascade delete propagates to all child records, so removing an upload cleans up all associated data.

**ParsedMessage:** Stores anonymized individual messages with speaker pseudonyms, timestamps, and optional token counts. Indexed on `(uploadId, timestamp)` for efficient chronological retrieval during job processing.

**Paper:** Contains all generated sections as `@db.Text` columns, relationship analysis fields (`relationshipType`, `relationshipIssues`, `affectionScores`), and the generation timestamp. Status transitions: `PROCESSING → COMPLETED | FAILED`.

**Job:** The execution control record. Key fields:

| Field | Purpose |
|---|---|
| `idempotencyKey` | SHA-256 unique key; shared with BullMQ `jobId` |
| `status` | PENDING → PROCESSING → COMPLETED \| FAILED |
| `progress` | 0–100 integer; updated at each pipeline stage |
| `attempts` / `maxAttempts` | Retry counter and ceiling (default max: 3) |
| `startedAt` | Recovery cutoff anchor (12-minute threshold) |
| `enqueuedAt` | PENDING recovery cutoff anchor (30-minute threshold) |
| `errorMessage` / `errorStack` | Last error for diagnostics |

**JobLog:** Append-only structured log with level, message, and JSON data blob. Automatically purged after **7 days** to prevent unbounded table growth.

**Export:** Tracks generated PDF and DOCX output files. Linked to Paper with cascade delete.

---

### 7.2 Transaction Consistency Guarantees

All multi-entity state transitions use `prisma.$transaction` with explicit **status guards** on both sides of each update:

```sql
-- Completion guard (processor.ts, final step)
UPDATE papers SET status = 'COMPLETED', title = ?, abstract = ?, ...
  WHERE id = ? AND status = 'PROCESSING'

UPDATE jobs SET status = 'COMPLETED', progress = 100, ...
  WHERE id = ? AND status = 'PROCESSING'

-- Transaction throws if either affected row count != 1
-- Prevents double-completion when a recovered job re-executes
-- while the original execution is still finishing
```

**Failure guard (jobService.ts, permanent failure path):**

```sql
-- Atomic Job + Paper failure on final attempt
BEGIN
  UPDATE jobs   SET status = 'FAILED' WHERE id = ? AND status IN ('PENDING','PROCESSING')
  UPDATE papers SET status = 'FAILED' WHERE id = paper.id AND status = 'PROCESSING'
COMMIT
```

> **Important:**  
> This prevents a Paper record from remaining permanently stuck in `PROCESSING` when its Job exhausts all retry attempts.

---

\newpage

## 8. Reliability Engineering

### 8.1 Worker Hard Timeout

```javascript
const LOCK_RENEW_MS = 2 * 60 * 1_000

Worker options:
  lockDuration:  jobTimeoutMs + 90_000   // lock outlasts hard deadline
  lockRenewTime: min(LOCK_RENEW_MS, floor(jobTimeoutMs / 3))

Hard deadline implementation:
  const controller = new AbortController()
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      controller.abort()
      reject(new JobTimeoutError(jobTimeoutMs))
    }, jobTimeoutMs)
  })
  await Promise.race([processPaperJob(data, controller.signal), timeout])
```

When `JobTimeoutError` is thrown, BullMQ's `failed` event fires, `markJobFailed()` is called with `isFinal` determined by remaining attempts, and the job is either retried or permanently failed.

---

### 8.2 Stuck Job Recovery (runs every 5 minutes)

**Path 1 — Stuck PROCESSING (12-minute threshold):**

```
Query: status = PROCESSING AND startedAt < now - 12 minutes

For each stuck job:
  if remainingAttempts <= 0 OR paperId == null:
    atomic transaction:
      Job   → FAILED (WHERE status = PROCESSING)
      Paper → FAILED (WHERE status = PROCESSING)
    continue

  bullJobId = job.idempotencyKey ?? job.id
  existing = await queue.getJob(bullJobId)

  if existing AND state in {active, waiting, delayed, prioritized, paused}:
    continue   // job is actively running — do not interfere

  if existing AND state in {failed, completed}:
    await existing.remove()   // clear stale BullMQ record

  added = await queue.add(payload, {
    jobId:    bullJobId,
    attempts: remainingAttempts,
    delay:    5_000,
  })

  // Optimistic DB guard: only update if still in PROCESSING state
  result = await prisma.job.updateMany(
    WHERE id = job.id AND status = 'PROCESSING'
    SET status = PENDING, progress = 0, startedAt = null
  )

  if result.count != 1:
    await added.remove()   // concurrent state change: rollback Redis entry
```

**Path 2 — Stuck PENDING (30-minute threshold):**

```
Query: status = PENDING AND enqueuedAt < now - 30 minutes

For each:
  bullJobId = job.idempotencyKey ?? job.id
  existing = await queue.getJob(bullJobId)
  if existing AND state in RUNNABLE_STATES: continue   // already in queue
  if existing: await existing.remove()
  await queue.add(payload, { jobId: bullJobId })
  // BullMQ jobId deduplication prevents double execution
```

**Path 3 — Log retention:**

```
await prisma.jobLog.deleteMany({
  where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000) } }
})
```

---

### 8.3 Graceful Shutdown

```
SHUTDOWN_TIMEOUT_MS = 4,000   // 1 second margin under Fly.io's default 5s SIGKILL

SIGTERM / SIGINT received
  → handleSignal(signal)
    → shutdown(signal).catch(err => { logger.fatal(err); process.exit(1) })
      → if shuttingDown: return   // idempotent guard
      → shuttingDown = true
      → clearInterval(recoveryTimer)
      → Promise.race([
          worker.close(),
          reject after SHUTDOWN_TIMEOUT_MS
        ])
      → process.exit(0)

On timeout:
  → process.exit(1)
```

The `handleSignal()` wrapper catches any rejection from the `shutdown()` promise, preventing an unhandled promise rejection from crashing the process before `process.exit` is reached.

---

\newpage

## 9. Security Architecture

### 9.1 Multi-Tier Rate Limiting

![Rate Limiting Tiers](./docs/diagrams/rate-limiting-tiers.png)

```
┌────────────────────────────────────────────────────────────┐
│  Tier 1: IP Preflight (Redis Lua — executes before any DB) │
│  Key:   preflight:ip:{sha256(clientIp)[0:32]}              │
│  Limit: 30 requests / 60 seconds per IP                    │
│  Fail behavior: fail-closed (Redis error → 429)            │
└────────────────────────┬───────────────────────────────────┘
                         │ passes
┌────────────────────────▼───────────────────────────────────┐
│  Tier 2: Route-Level (Redis Lua — IP + cookie guest key)   │
│  Upload:  IP 8/min,  Guest 6/min                           │
│  Analyze: IP 6/min,  Guest 4/min                           │
│  Guest key: extracted from cookie synchronously (no DB)    │
│  Fail behavior: fail-closed                                 │
└────────────────────────┬───────────────────────────────────┘
                         │ passes — DB access begins here
┌────────────────────────▼───────────────────────────────────┐
│  Tier 3: Daily Quota (PostgreSQL — after user creation)     │
│  Upload: 20 / day per user                                  │
│  Jobs:   concurrent ≤ 2, daily ≤ 10 (Serializable tx)      │
└────────────────────────────────────────────────────────────┘
```

> **Key Idea:**  
> The ordering is the critical security property. Because `getGuestUser()` (which executes `prisma.user.upsert`) is called only after Tier 1 and Tier 2 both pass, an attacker cannot trigger database writes at a rate exceeding the Redis limits, even with many IPs.

**Lua atomicity:**

```lua
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
```

> **Algorithm Insight:**  
> Executing INCR and EXPIRE in a single Lua script prevents the race condition where a process crash between the two commands leaves a counter key with **no TTL**, permanently blocking legitimate traffic on that key.

---

### 9.2 OpenAI Cost Controls

- Maximum **9,000 tokens per chunk** (10,000 budget minus 1,000 reserved for system prompt)
- Maximum **3 chunks per job** (relationship analysis: 1 call + chunk summaries: up to 3 calls + sections: 7 calls = maximum **11 LLM calls** per job)
- Exclusive use of `gpt-4o-mini` (approximately **15× cheaper** than `gpt-4o`)
- Quota check inside Serializable transaction prevents concurrent requests from both passing the daily limit simultaneously

---

\newpage

## 10. OpenAI Pipeline Architecture

### 10.1 Prompt Pipeline Layers

**Layer 1: Language Detection**
- Model: `gpt-4o-mini`, `temperature: 0`, JSON mode
- Input: Up to 80 message samples
- Output: `{ ko: float, en: float, ja: float }` normalized to sum 1.0
- Used to auto-select paper language if not explicitly provided

**Layer 2: Chunk Summarization**
- Model: `gpt-4o-mini`, `temperature: 0.2`, JSON mode
- Input: Per-chunk dialogue with speaker legend and date-range context header
- Output: `{ topics, sentimentLabel, keyEvents, speakerDynamics, speakerCount, speakerProfiles, groupDynamics }`
- Group-aware: system prompt adapts for 1:1 vs. multi-party conversations

**Layer 2.5: Relationship Analysis**
- Model: `gpt-4o-mini`, `temperature: 0.3`, JSON mode
- Input: First 200 messages (sampled for cost efficiency)
- Output: `{ relationshipType, confidence, isRomantic, hasIssues, issues, affectionScores }`
- Runs **in parallel** with chunk summarization to minimize wall-clock time

**Layer 3: Section Generation**
- Model: `gpt-4o-mini`, `temperature: 0.4`
- 7 writing styles with domain-specific system prompt modifiers
- 8 paper sections generated in two parallel batches

---

### 10.2 Writing Style Modifiers

Each `WritingStyle` injects a domain-specific instruction into the system prompt:

```
psychology_paper:       Use clinical psychology conventions. Apply hypothesis-testing
                        structure. Reference DSM where relevant.

communication_analysis: Apply pragmatics and speech-act theory (Austin/Searle).
                        Analyse turn-taking patterns.

relationship_dynamics:  Use relationship science and attachment theory (Bowlby/Ainsworth).
                        Focus on intimacy and conflict cycles.

sociology:              Use qualitative sociology and grounded theory.
                        Emphasise social context and structural factors.

behavioral_science:     Quantify behavioural patterns: frequency, reinforcement, extinction.
                        Apply operant conditioning framing.

computational_text:     Include NLP metrics (TF-IDF, topic modelling, sentiment
                        classification). Use formal notation.

bioinformatics:         Model conversation as time-series and network interactions.
                        Use systems-biology metaphors.
```

---

### 10.3 Section Generation Batching

Sections are generated in **two parallel batches** to minimize total wall time while respecting OpenAI's per-minute token budget:

```
Batch 1 (parallel):  title + abstract + introduction
Batch 2 (parallel):  methods + results + discussion + conclusion
```

Each section call includes the full `analysisContext` JSON (relationship analysis + all chunk summaries) as the user message, ensuring every section has access to the **complete analytical picture**.

---

\newpage

## 11. Core Algorithms

### 11.1 Chunking Algorithm

Segments conversation messages into token-bounded windows using a **sliding approach with overlap** for context continuity.

**Parameters:**

| Parameter | Value | Purpose |
|---|---|---|
| `chunkTokens` | 10,000 | Maximum tokens per chunk |
| `overlapTokens` | 64 | Context continuity overlap |
| `reservedForPrompt` | 1,000 | System prompt headroom |
| `MAX_CHUNKS` | 3 | Cost control ceiling |

**Token estimation:**

```
estimatedTokens = ceil(koreanChars × 1.5 + otherChars × 0.25)
```

> **Algorithm Insight:**  
> Korean characters consume approximately **1.5 GPT tokens** each due to multibyte encoding. Latin characters consume approximately **0.25 tokens** each. This bimodal estimation prevents context overflow when processing Korean-dominant conversations.

**Pseudocode:**

```
function chunkMessages(messages, config):
  maxPerChunk = 9,000  // chunkTokens - reservedForPrompt
  chunks = []
  start = 0

  while start < len(messages):
    tokens = estimateTokens(contextHeader)
    end = start

    while end < len(messages):
      msgCost = estimateTokens(messages[end].text)
      if tokens + msgCost > maxPerChunk AND end > start:
        break
      tokens += msgCost
      end++

    chunks.append(Chunk(messages[start:end], tokens))

    // Step back by overlapTokens for context continuity
    overlapStart = end
    accumulated = 0
    while overlapStart > start + 1:
      accumulated += estimateTokens(messages[overlapStart - 1].text)
      if accumulated >= 64: break
      overlapStart--
    start = overlapStart

  // Merge down to MAX_CHUNKS = 3
  while len(chunks) > 3:
    find adjacent pair (i, i+1) with minimum combined token count
    replace both with merged chunk

  set chunk.total = len(chunks) on all chunks
  return chunks
```

---

### 11.2 Retry and Exponential Backoff

**Retryable error classes:**
- HTTP 429 (Rate Limit)
- HTTP 5xx (Server Error)
- `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` (Network errors)
- Message contains `"fetch failed"`, `"network"`, or `"socket"`
- `error.name === 'AbortError'` (90-second per-request timeout)

**Non-retryable:** HTTP 4xx client errors — thrown immediately without retrying.

**Pseudocode:**

```
function callWithRetry(fn, maxRetries=5, parentSignal):
  for i in 0 .. maxRetries-1:
    if parentSignal?.aborted: throw 'Job aborted'

    controller = new AbortController()
    timer = setTimeout(controller.abort, 90_000)
    parentSignal?.addEventListener('abort', controller.abort, { once: true })

    try:
      result = await fn(controller.signal)
      return result

    catch error:
      if parentSignal?.aborted: throw 'Job aborted'

      retryable = (status == 429)
                  OR (status >= 500)
                  OR (code in {ECONNRESET, ETIMEDOUT, ENOTFOUND})
                  OR (message contains 'fetch failed'|'network'|'socket')
                  OR (error.name == 'AbortError')

      if NOT retryable: throw error
      if i == maxRetries - 1: throw error   // exhausted

      if status == 429:
        match = extract("try again in ([0-9.]+)s", error.message)
        delay = match ? ceil(match × 1000) + 500
                      : 1000 × 2^i + random(0, 1000)
      else:
        delay = 1000 × 2^i + random(0, 1000)

      await sleep(delay, parentSignal)   // interruptible sleep

    finally:
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', controller.abort)
```

---

### 11.3 Idempotency Control

**Pseudocode:**

```
function analyze(uploadId, style, lang):
  key = SHA256(uploadId + ":" + style + ":" + lang)

  try:
    (paper, job) = prisma.$transaction(SERIALIZABLE):
      assert concurrent jobs < 2
      assert daily jobs < 10
      paper = INSERT papers (status = PROCESSING)
      job   = INSERT jobs   (idempotencyKey = key, status = PENDING)
      return (paper, job)

  catch P2002:   // unique constraint: key already exists
    existing = SELECT FROM jobs WHERE idempotencyKey = key
    return existing   // prior job returned unchanged

  catch P2034:   // serialization failure
    return HTTP 409 CONFLICT

  queue.add('generate', payload, { jobId: key })
  // BullMQ: if a job with this jobId already exists, this is a no-op
```

---

### 11.4 Stuck Job Recovery

**Pseudocode (PROCESSING path):**

```
function recoverStuckJobs():
  cutoff = now - 12 minutes
  stuck = SELECT FROM jobs WHERE status = PROCESSING AND startedAt < cutoff

  for job in stuck:
    remainingAttempts = job.maxAttempts - job.attempts

    if remainingAttempts <= 0 OR job.uploadId == null:
      atomic:
        UPDATE jobs   SET status = FAILED WHERE id = job.id AND status = PROCESSING
        UPDATE papers SET status = FAILED WHERE id = job.paperId AND status = PROCESSING
      continue

    bullJobId = job.idempotencyKey ?? job.id
    existing  = await queue.getJob(bullJobId)

    if existing:
      state = await existing.getState()
      if state in RUNNABLE_STATES:   // active/waiting/delayed/prioritized/paused
        continue    // actively running — do not interfere
      if state NOT in REUSABLE_STATES:
        continue    // unknown state — skip safely
      await existing.remove()

    added = await queue.add(payload, {
      jobId:    bullJobId,
      attempts: remainingAttempts,
      delay:    5_000,
    })

    // Optimistic concurrency guard
    result = await prisma.job.updateMany(
      WHERE id = job.id AND status = PROCESSING
      SET   status = PENDING, progress = 0, startedAt = null
    )

    if result.count != 1:
      await added.remove()   // concurrent state change detected — rollback
```

---

### 11.5 Rate Limiting Algorithm

**Lua script (atomic INCR + conditional EXPIRE):**

```lua
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
```

**Pseudocode:**

```
function checkIpPreflightRateLimit(req):
  try:
    ip  = req.headers['x-forwarded-for'].split(',')[0]
           ?? req.headers['x-real-ip']
           ?? '0.0.0.0'
    key = "preflight:ip:" + sha256(ip)[0:32]
    n   = redis.eval(lua, keys=[key], args=[60])
    return n <= 30 ? { ok: true } : { ok: false }
  catch:
    log.error(...)
    return { ok: false }   // fail-closed

function checkRouteRateLimit(route, ip, cookieGuestKey):
  try:
    limits = ROUTE_LIMITS[route]
    [ipCount, guestCount] = await Promise.all([
      redis.eval(lua, "ratelimit:{route}:ip:{sha256(ip)}", 60),
      redis.eval(lua, "ratelimit:{route}:guest:{sha256(key)}", 60),
    ])
    ok = (ipCount <= limits.ip) AND (guestCount <= limits.guest)
    return ok ? { ok: true } : { ok: false }
  catch:
    return { ok: false }   // fail-closed
```

---

\newpage

## 12. Deployment Architecture

### 12.1 Fly.io Multi-Process Deployment

```toml
[build]
  dockerfile = "Dockerfile.worker"

[processes]
  worker = "node dist/server/worker/index.js"

[[vm]]
  memory = "512mb"
```

The worker runs as an **independent process** from the Next.js application. Both processes share the same PostgreSQL and Redis instances but scale and restart independently. The Next.js app handles all HTTP traffic; the worker handles all asynchronous job execution.

---

### 12.2 TypeScript Build Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "baseUrl": "..",
    "paths": { "@/*": ["src/*"] }
  },
  "include": [
    "../server/**/*",
    "../src/lib/nlp/**/*",
    "../src/lib/openai/**/*",
    "../src/types/**/*"
  ],
  "exclude": [
    "../src/app",
    "../src/components",
    "../src/lib/export"
  ]
}
```

> **Design Decision:**  
> `baseUrl: ".."` and `paths` are required to resolve `@/` aliases correctly in the worker build. `src/lib/export` is excluded to prevent `.tsx` files from being included in the server-side TypeScript compilation, which would fail without JSX configuration.

---

### 12.3 Required Environment Variables

```bash
OPENAI_API_KEY=         # OpenAI API key
DATABASE_URL=           # PostgreSQL connection string
REDIS_URL=              # Redis connection string
WORKER_CONCURRENCY=     # Number of concurrent jobs per worker instance
JOB_TIMEOUT_MS=         # Hard job timeout in milliseconds
```

---

\newpage

## 13. Performance and Scalability

### 13.1 Processing Time Breakdown

| Stage | Expected Duration |
|---|---|
| Message load (DB) | ~100 ms |
| Chunking (CPU) | < 10 ms |
| Relationship analysis (OpenAI) | 3–8 seconds |
| Chunk summarization × N (serial) | 3–8 seconds × N |
| Section batch 1 (parallel) | 5–15 seconds |
| Section batch 2 (parallel) | 5–15 seconds |
| Atomic save (DB) | ~200 ms |
| **Total** | **~2–8 minutes** |

---

### 13.2 Concurrency Controls

- **Worker concurrency:** configurable via `WORKER_CONCURRENCY` environment variable
- **BullMQ rate limiter:** maximum 2 jobs per 10 seconds globally
- **Serializable transaction:** prevents concurrent quota bypass
- `maxWait: 5,000ms`, `timeout: 30,000ms` on all transactions (deadlock prevention)

---

\newpage

## 14. Limitations and Future Work

| Limitation | Current State | Remediation Path |
|---|---|---|
| Shared empty-string rate-limit bucket | New visitors (no cookie) share one Redis bucket | Fall back to `getClientIp(req)` instead of `''` |
| Single LLM dependency | gpt-4o-mini only | Model selection UI; Anthropic Claude fallback |
| 3-chunk maximum | Information loss for very long conversations | Dynamic chunk count or hierarchical summarization |
| Single worker instance | No horizontal scaling | BullMQ distributed worker cluster |
| No user authentication | Guest-only access | NextAuth + account tiers |
| No export caching | PDF/DOCX regenerated on each request | Pre-generate and store in object storage |
| Lightweight anonymization | Pattern-based redaction only | Named entity recognition for Korean |

---

\newpage

## 15. System Diagrams

### 15.1 System Architecture

![System Architecture](./docs/diagrams/system-architecture.png)

```
[Browser / Mobile Client]
        │ HTTPS
        ▼
┌───────────────────────────────────────────────────────┐
│             Next.js API Layer (Fly.io)                 │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ /api/upload  │  │/api/analyze │  │/api/jobs/[id]│ │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘ │
└─────────┼─────────────────┼────────────────┼──────────┘
          │ Prisma ORM      │ ioredis         │ Prisma
          ▼                 ▼                 ▼
┌──────────────┐    ┌──────────────────────────────┐
│  PostgreSQL  │    │       Redis (BullMQ)           │
│  User/Upload │    │  paper-generation queue        │
│  Paper/Job   │    │  rate-limit counters           │
│  JobLog      │    └────────────┬──────────────────┘
└──────▲───────┘                │ Worker.process()
       │ atomic save  ┌─────────▼────────────────────┐
       └──────────────┤   Worker Process (Node.js)    │
                      │  processPaperJob()            │
                      │  chunker → promptPipeline     │
                      │  → OpenAI GPT-4o-mini         │
                      └──────────────────────────────┘
```

---

### 15.2 Queue Processing Flow

![Queue Processing Flow](./docs/diagrams/queue-processing-flow.png)

```
[POST /api/analyze]
       │
       ▼
[IP Preflight Rate Limit] ──FAIL──→ [429 Too Many Requests]
       │ PASS
       ▼
[Route Rate Limit (cookie key)] ──FAIL──→ [429]
       │ PASS
       ▼
[Serializable Transaction]
  ├─ Quota exceeded ──────────→ [429 Quota Exceeded]
  ├─ P2002 (duplicate key) ───→ [200 Return existing job]
  ├─ P2034 (serialization) ───→ [409 Conflict]
  └─ success: INSERT Paper + Job
       │
       ▼
[queue.add(jobId = SHA-256)] ──ERROR──→ [Rollback both to FAILED]
       │ success
       ▼
[200 OK: { jobId, paperId, status: PENDING }]
       │
       ▼
[BullMQ picks job from Redis]
       │
       ▼
[Worker executes processPaperJob()]
       │
       ▼
[Paper status → COMPLETED]
```

---

### 15.3 Worker Execution Flow

![Worker Execution Flow](./docs/diagrams/worker-execution-flow.png)

```
[BullMQ dispatches job]
       │
       ▼
[runWithHardDeadline + AbortController]
       │
       ▼
[markJobProcessing: PENDING → PROCESSING]
  count != 1 → skip (already taken)
       │
       ▼
[Load ParsedMessages from DB]
       │
       ▼
[chunkMessages() → max 3 chunks]
       │
       ▼
[Promise.all() — PARALLEL]
  ├── [analyseRelationship(signal)]
  └── [summariseChunk × N — serial with signal]
       │ both complete
       ▼
[Build analysisContext JSON]
       │
       ▼
[Batch 1 — PARALLEL]
  ├── title
  ├── abstract
  └── introduction
       │
       ▼
[Batch 2 — PARALLEL]
  ├── methods
  ├── results
  ├── discussion
  └── conclusion
       │
       ▼
[prisma.$transaction()]
  UPDATE Paper WHERE status = PROCESSING → COMPLETED
  UPDATE Job   WHERE status = PROCESSING → COMPLETED
  Throw if either count != 1
       │
       ▼
[Job Complete]
```

---

### 15.4 Retry and Backoff Loop

![Retry and Backoff Loop](./docs/diagrams/retry-backoff-loop.png)

```
[callWithRetry(fn, maxRetries = 5)]
       │
       ▼
[Check parentSignal.aborted?] ──YES──→ [throw 'Job aborted']
       │ NO
       ▼
[Create 90-second AbortController]
       │
       ▼
[await fn(controller.signal)] ──SUCCESS──→ [Return result]
       │ ERROR
       ▼
[Classify error]
  ├─ 4xx client error ─────────────→ [throw immediately]
  ├─ AbortError (90s timeout)
  ├─ HTTP 429 Rate Limit
  ├─ HTTP 5xx Server Error
  └─ Network error (ECONNRESET etc.)
       │ retryable
       ▼
[i == maxRetries - 1?] ──YES──→ [throw (exhausted)]
       │ NO
       ▼
[Compute delay]
  ├─ 429: parse "try again in Xs" → X×1000 + 500ms
  └─ other: 1000 × 2^i + random(0–1000)ms
       │
       ▼
[await sleep(delay, parentSignal)]
  (abort signal cancels sleep immediately)
       │
       ▼
[i++  →  loop back]
```

---

### 15.5 Job Recovery Flow

![Job Recovery Flow](./docs/diagrams/job-recovery-flow.png)

```
[Recovery Timer — every 5 minutes]
       │
  ┌────┴─────────────────────┬───────────────────────┐
  ▼                          ▼                       ▼
[Path 1: PROCESSING]    [Path 2: PENDING]        [Path 3: Logs]
[startedAt < now-12min] [enqueuedAt < now-30min] [> 7 days old]
  │                          │                       │
  ▼                          ▼                       ▼
[Attempts left?]        [Redis: RUNNABLE?]      [deleteMany]
  NO → [atomic FAILED]    YES → [skip]
  YES ↓                    NO ↓
[Redis state check]     [queue.add(bullJobId)]
  RUNNABLE → skip         [BullMQ deduplicates]
  TERMINAL → remove
  UNKNOWN  → skip
  ↓
[queue.add + DB updateMany]
  count != 1 → [rollback Redis]
```

---

\newpage

## Appendix: Technology Stack Summary

| Domain | Technology | Version / Configuration |
|---|---|---|
| Framework | Next.js App Router | 14+ |
| Language | TypeScript | strict mode |
| ORM | Prisma | PostgreSQL provider |
| Queue | BullMQ | v5.75.2+ |
| Redis client | ioredis | Split connections (API / Worker) |
| AI model | OpenAI GPT-4o-mini | temperature 0–0.4 |
| Deployment | Fly.io | 512 MB VM |
| Logging | pino | Structured JSON |
| Authentication | Guest cookie | 30-day expiry |
| Export formats | PDF, DOCX | On-demand generation |

---

*Chat Paper AI Technical Whitepaper — Version 2.0 — April 2025*
