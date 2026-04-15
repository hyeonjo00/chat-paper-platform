# Chat Paper

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

카카오톡 대화와 AI 대화를 학술 논문 초안으로 바꾸는 한국어 우선 AI SaaS입니다.

![Chat Paper 홈](docs/screenshots/home-dark.png)

## 소개

Chat Paper는 대화 파일을 업로드하고, 흐름과 어조를 분석한 뒤, 연구 대시보드와 논문형 리더로 이어지는 학술 문서 초안을 생성합니다.

## 스크린샷

### 랜딩

![랜딩 화면](docs/screenshots/home-dark.png)

### 업로드 플로우

![업로드 화면](docs/screenshots/upload-flow.png)

### 보안 로그인

![로그인 화면](docs/screenshots/signin-dark.png)

## 핵심 특징

- 다크 모드와 `KO / JA / EN` 전환을 지원하는 한국어 우선 프리미엄 UI
- 카카오톡 및 AI 대화 업로드 플로우
- 대화 파싱 및 분석 파이프라인
- 내보내기 액션이 포함된 논문형 리더
- Next.js App Router, Prisma, NextAuth, OpenAI 기반 구성

## 기술 스택

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma + PostgreSQL
- NextAuth
- OpenAI API

## 빠른 시작

```bash
npm install
npm run db:generate
npm run db:push
npm run dev
```

Prisma 명령과 개발 서버 실행 전에 `.env.example`을 `.env.local`로 복사해 주세요.

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 열면 됩니다.

## 환경 변수

`.env.example`을 복사해 `.env.local`을 만드세요.

```bash
OPENAI_API_KEY=
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## 주요 경로

- `/` 랜딩
- `/upload` 업로드 및 분석 시작
- `/result?paperId=...` 연구 대시보드
- `/paper/[paperId]` 논문 리더
- `/signin` 커스텀 로그인 화면

## 참고

- 결과 페이지와 논문 리더는 로그인 후 접근할 수 있습니다.
- Google OAuth를 쓰려면 client ID와 secret이 필요합니다.
- Prisma 명령이 동작하려면 로컬 PostgreSQL이 실행 중이어야 합니다.
