# Chat Paper AI Technical Whitepaper

**Version:** 1.0  
**Project:** Chat Paper AI  
**Repository:** <https://github.com/hyeonjo00/chat-paper-platform>  
**Category:** Korean-first AI SaaS, conversation analysis, academic paper generation

## Abstract

Chat Paper AI is a Korean-first AI SaaS platform that transforms KakaoTalk exports and AI conversation logs into academic-style research papers. The system combines file ingestion, conversation parsing, anonymization, language detection, chunk-based AI analysis, paper generation, and a reader-focused result dashboard.

The product is designed around a low-friction guest workflow: users can upload a conversation file, generate an academic draft, inspect the result, and export the paper without creating an account. Raw uploaded files are not permanently stored; the application persists parsed and anonymized conversation records needed for paper generation and result review.

## 1. Product Problem

Conversational data contains patterns that are difficult to evaluate manually: topic shifts, emotional tone, relationship dynamics, speaker roles, and communication habits. Existing note-taking or chat export tools usually preserve the raw dialogue but do not convert it into a structured analytical artifact.

Chat Paper AI addresses this gap by turning informal conversations into structured academic drafts. The output is not only a generated text response; it is a research-style document organized into title, abstract, introduction, methods, results, discussion, and conclusion.

## 2. System Goals

- Provide a Korean-first upload and analysis experience for KakaoTalk conversation exports.
- Support AI conversation formats such as Markdown, text, and JSON.
- Convert long dialogue logs into chunked summaries before final paper generation.
- Preserve a simple guest-first flow without mandatory authentication.
- Avoid permanent raw file storage and anonymize parsed message content before persistence.
- Present generated results in a dashboard and journal-grade paper reader.
- Keep the architecture deployable on Vercel with PostgreSQL, Prisma, and OpenAI.

## 3. High-Level Architecture

```mermaid
flowchart LR
  U[User] --> UI[Next.js App Router UI]
  UI --> Upload[/api/upload]
  Upload --> Parser[Conversation Parsers]
  Parser --> Privacy[Anonymization Layer]
  Privacy --> DB[(PostgreSQL via Prisma)]
  UI --> Analyze[/api/analyze]
  Analyze --> Lang[Language Detection]
  Lang --> PaperRecord[PROCESSING Paper Record]
  UI --> Generate[/api/papers/:paperId/generate]
  Generate --> Chunker[Message Chunking]
  Chunker --> OpenAI[OpenAI Paper Pipeline]
  OpenAI --> DB
  DB --> Dashboard[Research Dashboard]
  DB --> Reader[Academic Paper Reader]
  Reader --> Export[Export Actions]
```

The frontend and backend are colocated in a Next.js App Router application. API routes handle ingestion, analysis orchestration, paper generation, and paper retrieval. Prisma provides typed access to PostgreSQL, while the OpenAI layer handles chunk summaries, relationship analysis, and final paper section generation.

## 4. Upload And Parsing Flow

The upload route accepts `.zip`, `.txt`, `.md`, and `.json` inputs. For KakaoTalk ZIP exports, the server extracts the largest `.txt` file inside the archive and treats it as the primary conversation transcript. Non-ZIP files are read directly.

The system then determines whether the file resembles a KakaoTalk export or an AI conversation. KakaoTalk logs are normalized into speaker, timestamp, and message text records. AI conversation files are parsed from JSON, Markdown, or plain text into a consistent role-based structure.

After parsing, the application stores only the structured conversation data needed for analysis. The raw file itself is not persisted as a downloadable object.

## 5. Privacy And Guest Session Model

Chat Paper AI uses a browser-scoped guest session cookie to associate uploads and papers with the current visitor. This enables a login-free workflow while still enforcing ownership checks between upload, result, and paper routes.

Before parsed messages are stored, the privacy layer attempts to redact common sensitive patterns such as phone numbers, identification numbers, locations, and names. This reduces exposure in both database records and downstream AI prompts.

The current privacy model is intentionally lightweight for MVP speed. Future production hardening can add explicit data retention controls, user-triggered deletion, audit logging, and stronger entity recognition for Korean names and addresses.

## 6. Data Model

The Prisma schema is organized around five primary entities:

- `User`: guest or authenticated user identity.
- `Upload`: uploaded file metadata and parsing status.
- `ParsedMessage`: normalized and anonymized conversation messages.
- `Paper`: generated academic paper sections and analysis metadata.
- `Export`: exported document metadata.

The relationships are cascade-aware: users own uploads and papers, uploads own parsed messages, and papers own exports. This keeps cleanup behavior predictable when a user or upload is removed.

## 7. AI Generation Pipeline

The paper generation pipeline is designed for long conversation logs:

1. Parsed messages are loaded in chronological order.
2. Messages are anonymized again before AI generation.
3. The system detects the dominant language and stores the requested paper language.
4. Long conversations are split into chunks to stay within model context and rate limits.
5. Each chunk is summarized into topics, sentiment, speaker dynamics, and key events.
6. Relationship analysis infers conversation type, issues, and optional affection scores.
7. Paper sections are generated in batches using the aggregated analysis context.
8. The paper record is updated from `PROCESSING` to `COMPLETED` or `FAILED`.

OpenAI calls use retry behavior for rate limit responses, improving stability during generation bursts.

## 8. Frontend Experience

The visible product is organized into four main surfaces:

- Landing page: minimal product positioning, language switching, and theme controls.
- Upload flow: drag-and-drop upload, staged loading states, and clear CTA progression.
- Result dashboard: paper metadata, status, analysis framing, and reader navigation.
- Paper reader: journal-style layout for title, abstract, methods, results, discussion, and conclusion.

The UI is built with reusable layout, button, card, badge, and copy layers. The design direction emphasizes Korean-first typography, premium SaaS spacing, dark mode readiness, and mobile responsiveness.

## 9. Deployment Model

The platform is intended to run on Vercel with:

- Next.js App Router for UI and API routes.
- PostgreSQL as the primary database.
- Prisma Client generated during install.
- OpenAI API key supplied through environment variables.
- Vercel function duration settings for upload and analysis routes.

Required environment variables include:

```bash
OPENAI_API_KEY=
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

OAuth environment variables can remain optional when the guest-first flow is used.

## 10. Reliability Considerations

The system includes several production-oriented safeguards:

- File type validation before parsing.
- Multipart form validation for upload requests.
- Ownership checks before reading or generating a paper.
- Explicit paper status transitions.
- OpenAI generation failure handling that marks papers as `FAILED`.
- Polling-friendly paper retrieval for long-running generation.
- Retry handling for OpenAI rate-limit errors.

Known areas for future hardening include queue-based background jobs, stricter upload size limits per deployment tier, observability dashboards, user-visible retry controls, and automated data retention cleanup.

## 11. Technical Impact

Chat Paper AI demonstrates a full-stack AI product pattern: transforming unstructured user data into a structured knowledge artifact. The project combines frontend product polish, file parsing, database modeling, privacy-aware preprocessing, AI orchestration, and export-ready document UX in a single deployable SaaS application.

The architecture is intentionally modular so that parsers, paper styles, export formats, retention policies, and AI models can evolve independently without changing the core user journey.

