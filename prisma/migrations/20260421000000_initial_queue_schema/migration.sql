-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('KAKAO', 'AI_CONVERSATION', 'INSTAGRAM', 'LINE');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'PARSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('KO', 'EN', 'JA');

-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WritingStyle" AS ENUM ('PSYCHOLOGY_PAPER', 'COMMUNICATION_ANALYSIS', 'RELATIONSHIP_DYNAMICS', 'SOCIOLOGY', 'BEHAVIORAL_SCIENCE', 'COMPUTATIONAL_TEXT', 'BIOINFORMATICS');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'DOCX');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UploadType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parsedAt" TIMESTAMP(3),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parsed_messages" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "speakerId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "lang" TEXT,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parsed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "writingStyle" "WritingStyle" NOT NULL,
    "status" "PaperStatus" NOT NULL DEFAULT 'PROCESSING',
    "title" TEXT,
    "abstract" TEXT,
    "introduction" TEXT,
    "relatedWork" TEXT,
    "methods" TEXT,
    "results" TEXT,
    "discussion" TEXT,
    "conclusion" TEXT,
    "references" JSONB,
    "appendix" TEXT,
    "relationshipType" TEXT,
    "relationshipIssues" TEXT,
    "affectionScores" JSONB,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT,
    "paperId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "idempotencyKey" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "uploads_userId_idx" ON "uploads"("userId");

-- CreateIndex
CREATE INDEX "parsed_messages_uploadId_idx" ON "parsed_messages"("uploadId");

-- CreateIndex
CREATE INDEX "parsed_messages_uploadId_timestamp_idx" ON "parsed_messages"("uploadId", "timestamp");

-- CreateIndex
CREATE INDEX "papers_userId_idx" ON "papers"("userId");

-- CreateIndex
CREATE INDEX "papers_uploadId_idx" ON "papers"("uploadId");

-- CreateIndex
CREATE INDEX "exports_paperId_idx" ON "exports"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotencyKey_key" ON "jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "jobs_userId_idx" ON "jobs"("userId");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_uploadId_idx" ON "jobs"("uploadId");

-- CreateIndex
CREATE INDEX "jobs_idempotencyKey_idx" ON "jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "job_logs_jobId_idx" ON "job_logs"("jobId");

-- CreateIndex
CREATE INDEX "job_logs_jobId_createdAt_idx" ON "job_logs"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parsed_messages" ADD CONSTRAINT "parsed_messages_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
