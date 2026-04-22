# Chat Paper

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

**KakaoTalk・Instagram DM・LINE・AI会話ログを、アカウント不要で学術論文に変換する非同期AIパイプライン**

![Chat Paper ホーム](docs/screenshots/home-dark.png)

---

## 概要

Chat Paperは、明確な課題を解決する。会話データには分析的に価値ある信号が含まれている — トピックの推移、感情の流れ、話者のダイナミクス、コミュニケーションパターン。しかし、それを構造化された引用可能な形式として表出するツールはこれまで存在しなかった。

本プラットフォームは、生の会話エクスポートファイルを受け取り、サーバー上でパース・匿名化を行い、長時間稼働するAI生成ジョブをキューに登録し、タイトル・要旨・序論・研究方法・結果・考察・結論を含む完全な学術論文を生成する。7つの文体スタイルをサポートする：心理学論文、コミュニケーション分析、関係性ダイナミクス、社会学、行動科学、計算テキスト分析、バイオインフォマティクス。

全フローはゲストファーストで設計されている。アカウントは不要。ブラウザスコープのセッションクッキーがアップロードと結果を紐づける。

---

## スクリーンショット

### ランディング

![ランディング画面](docs/screenshots/home-dark.png)

### アップロードフロー

![アップロード画面](docs/screenshots/upload-flow.png)

### 研究ダッシュボード

![結果ダッシュボード](docs/screenshots/result-dashboard.png)

### 論文リーダー

![論文リーダー](docs/screenshots/paper-reader.png)

### モバイルプレビュー

| ランディング | アップロード |
| --- | --- |
| ![モバイルランディング](docs/screenshots/mobile-home.png) | ![モバイルアップロード](docs/screenshots/mobile-upload.png) |
| ダッシュボード | リーダー |
| ![モバイルダッシュボード](docs/screenshots/mobile-result-dashboard.png) | ![モバイル論文リーダー](docs/screenshots/mobile-paper-reader.png) |

---

## アーキテクチャ

システムは非同期パイプラインを中心に構築されている。論文生成は会話の長さに応じて2〜8分かかるため、同期HTTPではタイムアウトが発生する。キューはインジェストと処理を分離し、リトライ・冪等性・リカバリを標準機能として提供する。

```
クライアント
  │
  │  HTTPS
  ▼
Next.js APIレイヤー  ────────────────────────────────────────────────
  │  /api/upload        /api/analyze        /api/jobs/[id]
  │
  ├── Tier 1: IPプリフライトレート制限（Redis、DB接続前）
  ├── Tier 2: ルートレート制限（Redis、IP + クッキーゲストキー）
  ├── Tier 3: 日次クォータチェック（PostgreSQL、レート制限通過後）
  │
  ├── アップロード経路: パース → 匿名化 → ParsedMessage保存 → 200 OK
  │
  └── 分析経路:       SHA-256冪等性キー
                      Serializableトランザクション: クォータ + Paper + Job作成
                      queue.add(jobId = idempotencyKey)
                      │
  ┌───────────────────┘
  │
  ▼
Redis（BullMQキュー）
  paper-generationキュー
  レート制限カウンターキー
  preflight:ip:*キー
  │
  │  Worker.process()
  ▼
Node.jsワーカープロセス（Fly.io）
  processPaperJob(data, abortSignal)
  │
  ├── markJobProcessing（PENDING → PROCESSING）
  ├── DBからParsedMessageを読み込み
  ├── chunkMessages() → 最大3チャンク
  ├── Promise.all: analyseRelationship + summariseChunk × N
  ├── generatePaperSection × 7（2バッチ並列）
  └── prisma.$transaction: Paper + Job → COMPLETED（アトミック）
  │
  ▼
PostgreSQL（Prisma）
  User / Upload / ParsedMessage / Paper / Job / JobLog / Export
```

**BullMQを使う理由:** 論文生成には、リトライロジックを持つ複数の逐次・並列OpenAI呼び出しが含まれる。BullMQはRedisベースの永続的なジョブストレージ、指数バックオフリトライ、`jobId`による冪等性、進捗追跡、スタックジョブのリカバリを提供する。

---

## 技術スタック

| レイヤー | 技術 | 目的 |
|---|---|---|
| **API** | Next.js 14 App Router | HTTPエンドポイント、ミドルウェア、SSR |
| **言語** | TypeScript（strict） | エンドツーエンドの型安全性 |
| **スタイリング** | Tailwind CSS + shadcn/ui | コンポーネントシステム |
| **キュー** | BullMQ v5 | 非同期ジョブキュー、リトライ、冪等性 |
| **キューブローカー** | Redis（ioredis） | BullMQブローカー + レート制限カウンター |
| **ワーカー** | Node.jsスタンドアロン | 長時間稼働AIパイプラインの実行 |
| **ORM** | Prisma | 型安全なPostgreSQLアクセス |
| **データベース** | PostgreSQL | 状態の永続化、トランザクション |
| **AI** | OpenAI GPT-4o-mini | 会話分析 + 論文生成 |
| **ロギング** | pino | 構造化JSONログ |
| **デプロイ** | Fly.io（ワーカー）+ Vercel（API） | 独立したスケーリング |

---

## コアバックエンド設計

### APIレイヤー

**アップロード検証（7段階の逐次ゲート）:**

```
1. checkIpPreflightRateLimit    Redis INCR、IPのみ、30回/60秒 — DB接続前
2. checkRouteRateLimit          Redis INCR、IP（8回/分）+ ゲストクッキー（6回/分）
3. validateContentLength        ヘッダー検査: 欠如 → 拒否、51MB超 → 拒否
4. getGuestUser()               最初のDB接続: prisma.user.upsert
5. checkUploadQuota             DBカウント: ユーザーあたり日次最大20回
6. req.formData()               ボディストリーミング開始
7. パース → 匿名化 → 保存
```

手順1〜3を手順4より前に配置することがDB DoS防御の核心である。攻撃者は2つの独立したRedisチェックをクリアしなければ`prisma.user.upsert`（書き込み操作）をトリガーできない。

**ZIPボム対策:**

```
最大エントリ数:              500
エントリあたりの最大非圧縮サイズ: 50 MB
全体の最大非圧縮サイズ:      100 MB（全エントリの累積合計）
メタデータ整合性:            解凍前にJSZip _data.uncompressedSizeを
                             非負の安全な整数として検証
```

**形式自動検出:** `.html/.htm` → Instagram DM; `timestamp_ms` + `sender_name`を含む`.json` → Instagram DM; タブ区切りタイムスタンプ → LINE; `*Human/*Assistant` → AI会話; 韓国語日付パターン → KakaoTalk。

---

### キューレイヤー

**BullMQ設定:**

```javascript
PAPER_JOB_OPTIONS = {
  attempts:         3,
  backoff:          { type: 'exponential', delay: 5_000 },  // 5秒 → 10秒 → 20秒
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 500 },
  jobId:            idempotencyKey,   // SHA-256(uploadId:style:lang)
}

ワーカー設定:
  lockDuration:  jobTimeoutMs + 90_000   // ハードデッドラインより90秒の余裕
  lockRenewTime: min(2分, jobTimeoutMs / 3)
  limiter:       { max: 2, duration: 10_000 }
```

**冪等性:** `(uploadId, writingStyle, lang)`のSHA-256ハッシュが、BullMQの`jobId`とPostgreSQLの`idempotencyKey`ユニーク制約の両方として使用される。重複リクエストはDBのユニーク制約で`P2002`が発生し、新たなジョブを作成せず既存のジョブを返す。

**分析用Serializableトランザクション:**

```
BEGIN ISOLATION LEVEL SERIALIZABLE
  同時実行中のジョブ数 < 2 を確認
  日次ジョブ数 < 10 を確認
  INSERT INTO papers（status = PROCESSING）
  INSERT INTO jobs（idempotencyKey、status = PENDING）
COMMIT
→ P2034（直列化失敗）→ 409
→ P2002（冪等性キー存在）→ 既存ジョブを返す
```

---

### ワーカーレイヤー

**ジョブライフサイクル:**

```
BullMQがキューからジョブを取得
  → runWithHardDeadline(data, jobTimeoutMs)
      AbortController作成
      setTimeout(abort, jobTimeoutMs)
      Promise.race([processPaperJob(...), タイムアウト])
  → markJobProcessing: PENDING → PROCESSING（アトミック、count == 1ガード）
  → ParsedMessageを読み込み（DB）
  → chunkMessages() — スライディングウィンドウ、最大3チャンク
  → Promise.all:
      analyseRelationship(signal)      並列
      summariseChunk × N（逐次）       並列ブランチ
  → セクションバッチ1: title + abstract + introduction（並列）
  → セクションバッチ2: methods + results + discussion + conclusion（並列）
  → prisma.$transaction:
      UPDATE papers WHERE status = PROCESSING → COMPLETED
      UPDATE jobs   WHERE status = PROCESSING → COMPLETED
      count ≠ 1の場合は例外をスロー
```

**AbortSignal伝播:** ジョブタイムアウト → `AbortController.abort()` → 各ステップ間で`signal.aborted`をチェック → `callWithRetry`のループ開始時に`parentSignal.aborted`をチェック → リクエスト別コントローラーの中断 → OpenAI SDKがインフライトfetchをキャンセル。

**チャンキングアルゴリズム:**

```
トークン推定:   ceil(韓国語文字数 × 1.5 + その他文字数 × 0.25)
チャンク予算:   9,000トークン（10,000 − 1,000システムプロンプト予約）
オーバーラップ: 64トークン（チャンク境界のコンテキスト継続性）
最大チャンク数: 3（コスト制御 — 超過時は最小隣接ペアをマージ）
```

**進捗追跡:** 各ステージで`jobs.progress`を更新: 5% → 10% → 30% → 55% → 75% → 95% → 100%。

---

### データベースレイヤー

**スキーマ概要:**

```
User           ゲストまたは認証済みユーザーの識別情報
Upload         ファイルメタデータ、パースステータス → ParsedMessage、Paper、Jobを所有
ParsedMessage  匿名化されたメッセージ（speakerId、timestamp、text）
               インデックス: (uploadId、timestamp)
Paper          7セクションすべてを@db.Textで格納、関係性分析フィールド
               ステータス: PROCESSING → COMPLETED | FAILED
Job            実行制御レコード
               idempotencyKey（ユニーク）、status、progress 0-100
               startedAt（12分リカバリ基準）
               enqueuedAt（30分PENDINGリカバリ基準）
               attempts / maxAttempts
JobLog         追記専用の構造化ログ、7日後に自動削除
Export         PDF / DOCXメタデータ
```

**トランザクション整合性:** すべての複数エンティティの状態遷移は、両側にステータスガードを持つ`prisma.$transaction`を使用する:

```sql
UPDATE papers SET status = 'COMPLETED' WHERE id = ? AND status = 'PROCESSING'
UPDATE jobs   SET status = 'COMPLETED' WHERE id = ? AND status = 'PROCESSING'
-- いずれかの影響行数 ≠ 1 の場合は例外をスロー
-- リカバリされたジョブが再実行中に元の実行が完了処理を試みる
-- 二重完了を防止する
```

---

## 処理フロー

エンドツーエンドのステップバイステップ:

```
1.  ユーザーがファイルをアップロード（POST /api/upload）
2.  IPプリフライト → ルートレート制限 → Content-Lengthチェック
3.  ゲストユーザーのupsert（最初のDB書き込み）
4.  日次アップロードクォータチェック
5.  ファイルパース: KakaoTalk / Instagram / LINE / AI会話
6.  メッセージの匿名化（PII パターンのリダクション）
7.  ParsedMessageをDBに保存
8.  ユーザーがuploadId + style + langでPOST /api/analyzeを呼び出す
9.  IPプリフライト → ルートレート制限
10. ゲストユーザーの読み込み
11. SHA-256冪等性キーを導出
12. Serializableトランザクション: クォータチェック + Paper作成 + Job作成
13. jobId = idempotencyKeyとしてRedisにジョブをエンキュー
14. ワーカーがBullMQキューからジョブを取得
15. DBからメッセージを読み込み、最大3つのトークンウィンドウにチャンク化
16. 並列: OpenAI経由で関係性分析 + チャンクサマリー
17. OpenAI経由で論文セクションを生成（2バッチ並列）
18. アトミックトランザクション: Paper + JobをCOMPLETEDとしてマーク
19. クライアントがGET /api/jobs/[jobId]をポーリング → 完了時にpaperIdを受信
20. 学術リーダーで論文をレンダリング、エクスポートオプションを提供
```

---

## 信頼性と安全性

### リトライとバックオフ

```
最大リトライ回数:   5回
リクエストごとのタイムアウト: 90秒（AbortController）

リトライ対象:  HTTP 429、HTTP 5xx、ECONNRESET、ETIMEDOUT、
               ENOTFOUND、"fetch failed"、"network"、"socket"、AbortError

バックオフ:
  429:   "try again in Xs"をパース → X × 1000 + 500ms
  その他: 1000 × 2^attempt + random(0〜1000)ms

リトライ不可: 4xxクライアントエラー（即時スロー）
```

`sleep()`関数は中断可能である。バックオフ待機中に親AbortSignalが発火した場合、遅延の満了を待たずに直ちに中断エラーを発生させる。

### スタックジョブリカバリ（5分ごとに実行）

**PROCESSINGパス（12分閾値）:**

```
status = PROCESSING かつ startedAt < now - 12分 の各ジョブに対して:
  試行回数が尽きた場合:
    アトミック: Job → FAILED、Paper → FAILED
  残りの試行回数がある場合:
    bullJobIdのRedis状態を確認
    RUNNABLE（active/waiting/delayed）の場合: スキップ（実行中）
    TERMINAL（failed/completed）の場合: 削除後に再エンキュー
    DB楽観的ガード: updateMany WHERE status = PROCESSING
    count ≠ 1の場合: キューアイテムを削除（競合状態ロールバック）
```

**PENDINGパス（30分閾値）:** Redisエントリが失われたジョブを再エンキューする。BullMQの`jobId`重複排除により、Redisエントリがまだ存在している場合でも二重実行を防ぐ。

**ログパージ:** 各リカバリスイープで7日以上経過した`jobLog`行を削除する。

### グレースフルシャットダウン

```
SHUTDOWN_TIMEOUT_MS = 4,000ms（Fly.ioのデフォルト5秒SIGKILLより1秒の余裕）

SIGTERM → handleSignalラッパー（リジェクションをキャッチ）
  → shuttingDown = true（冪等性ガード）
  → clearInterval(recoveryTimer)
  → Promise.race([worker.close(), 4秒タイムアウト])
  → process.exit(0)
```

---

## セキュリティとコスト制御

### 多層レート制限

```
Tier 1 — IPプリフライト（Redis Lua、DB接続前）:
  キー:   preflight:ip:{sha256(ip)[0:32]}
  制限:   IP1件あたり 30回 / 60秒
  動作:   フェイルクローズ（Redisエラー → 429）

Tier 2 — ルートレベル（Redis Lua、IP + クッキーゲストキー）:
  アップロード: IP 8回/分、ゲスト 6回/分
  分析:         IP 6回/分、ゲスト 4回/分
  注記:         ゲストキーはクッキーから読み取り — DB不要

Tier 3 — 日次クォータ（PostgreSQL、ゲスト作成後）:
  アップロード: 日次20回
  ジョブ:       同時実行 ≤ 2件、日次 ≤ 10件（Serializableトランザクション内で強制）
```

**Luaの原子性:** INCRとEXPIREを単一のLuaスクリプトで実行することにより、2コマンド間のクラッシュでTTLのないカウンターキーが残り、そのキーを永久にブロックするバグを防ぐ。

### アップロード制限

- ファイルサイズ: 最大50 MB
- ZIPエントリ数: 最大500件
- ZIP全体の非圧縮サイズ: 最大100 MB
- 許可する拡張子: `.txt`、`.md`、`.json`、`.html`、`.htm`、`.zip`

### OpenAIコスト制御

- モデル: `gpt-4o-mini`専用
- チャンクあたりの最大トークン: 9,000
- ジョブあたりの最大チャンク数: 3（最大約11回のLLM呼び出し）
- 日次ジョブクォータをSerializableトランザクション内で強制（並列バイパス不可）

---

## プロジェクト構造

```
chat-paper-platform/
│
├── src/
│   ├── app/                    Next.js App RouterのページとAPIルート
│   │   ├── api/
│   │   │   ├── upload/         ファイルの取り込み、パース、匿名化
│   │   │   ├── analyze/        ジョブ作成、冪等性、キューエントリ
│   │   │   ├── jobs/[jobId]/   ジョブステータスポーリング、所有権チェック
│   │   │   ├── papers/         論文の取得と生成トリガー
│   │   │   └── results/        ダッシュボード用の結果集約
│   │   ├── upload/             アップロードページ（クライアント）
│   │   ├── result/             研究ダッシュボード（クライアント）
│   │   └── paper/[paperId]/    学術論文リーダー（クライアント）
│   │
│   ├── components/             再利用可能なUIコンポーネント（shadcn/uiベース）
│   ├── lib/
│   │   ├── api/                レスポンスヘルパー、レート制限
│   │   ├── auth/               ゲストセッションクッキーロジック
│   │   ├── db/                 Prismaクライアントシングルトン
│   │   ├── nlp/                チャンカー、言語検出器
│   │   ├── openai/             callWithRetry、promptPipeline
│   │   ├── parsers/            KakaoTalk、Instagram、LINE、AIパーサー
│   │   └── privacy/            PIIの匿名化
│   └── types/                  共有TypeScript型定義
│
├── server/
│   ├── db/                     ワーカープロセス用Prismaクライアント
│   ├── lib/                    ロガー（pino）、環境変数ローダー
│   ├── queue/                  BullMQキュー定義、Redis接続
│   ├── services/               jobService（DB状態遷移）
│   └── worker/
│       ├── index.ts            ワーカーエントリポイント、シャットダウン処理
│       ├── processor.ts        processPaperJobパイプライン
│       └── recovery.ts         スタックジョブリカバリ、ログパージ
│
├── prisma/
│   └── schema.prisma           完全なデータモデル
│
└── docs/
    ├── chat-paper-ai-technical-whitepaper-en.md
    └── chat-paper-ai-technical-whitepaper-ko.md
```

---

## 技術ホワイトペーパー

アルゴリズムの疑似コード、ダイアグラム説明、トランザクション設計、信頼性エンジニアリングを含む完全なシステム設計ドキュメント:

- [Technical Whitepaper (English)](docs/chat-paper-ai-technical-whitepaper-en.md)
- [技術ホワイトペーパー（韓国語）](docs/chat-paper-ai-technical-whitepaper-ko.md)

---

## デプロイ

### ワーカー — Fly.io

ワーカープロセスはNext.jsアプリケーションとは独立して、Fly.io上で稼働する。

```toml
# fly.toml
[processes]
  worker = "node dist/server/worker/index.js"

[[vm]]
  memory = "512mb"
```

ワーカーのTypeScriptビルドは専用の`server/tsconfig.json`を使用する。`baseUrl: ".."` と `paths: { "@/*": ["src/*"] }` の設定により、`@/lib/openai`や`@/types`のパスがNext.jsコンパイラなしのスタンドアロンNode.jsビルドでも正しく解決される。

### API — Vercel（またはFly.io）

Next.jsアプリケーションはVercelまたは任意のNode.jsホストにデプロイされる。両プロセスは同一のPostgreSQLとRedisインスタンスを共有する。

### 環境変数

```bash
OPENAI_API_KEY=           # OpenAI APIキー
DATABASE_URL=             # PostgreSQL接続文字列（プーリング込み）
REDIS_URL=                # Redis接続文字列
WORKER_CONCURRENCY=       # ワーカーインスタンスあたりの同時実行ジョブ数（デフォルト: 2）
JOB_TIMEOUT_MS=           # ハードジョブタイムアウト（ms、例: 600000 = 10分）
NEXTAUTH_SECRET=          # NextAuthシークレット（ゲスト専用フローでも必要）
NEXTAUTH_URL=             # Next.jsアプリの公開URL
```

### ローカル起動

```bash
npm install
cp .env.example .env.local
# .env.local に DATABASE_URL、REDIS_URL、OPENAI_API_KEY を設定
npm run db:generate
npm run db:push
npm run dev
# 別のターミナルで:
npm run build:worker
npm run worker
```

[http://localhost:3000](http://localhost:3000) を開く。

### 主なルート

| ルート | 目的 |
|---|---|
| `/` | ランディングページ |
| `/upload` | アップロードと分析の開始 |
| `/result?paperId=...` | 研究ダッシュボード |
| `/paper/[paperId]` | 学術論文リーダー |

---

## 制限事項

| 領域 | 現状 |
|---|---|
| 新規訪問者のレート制限 | クッキーなしのリクエストが空文字列のRedisバケットを共有 — 同時新規訪問者が互いのゲストレート制限を消費する可能性がある |
| チャンク上限 | 会話の長さに関わらず最大3チャンク — 非常に長い会話では情報が失われる可能性がある |
| 単一LLMモデル | `gpt-4o-mini`専用 — モデル選択なし、フォールバックなし |
| ワーカーのスケーリング | 単一ワーカーインスタンス — 水平スケーリング未対応 |
| 匿名化 | パターンベースのPIIリダクション — 韓国語の氏名・住所に対する固有名詞認識なし |
| エクスポートキャッシュなし | リクエストごとにPDF/DOCXを再生成 |

---

## 今後の改善

- ゲストクッキーが存在しない場合にIPアドレスへフォールバック（共有レート制限バケットの解消）
- 非常に長い会話のための動的チャンク数
- モデル選択（Claude、GPT-4o）+ コストティアUI
- 水平BullMQワーカークラスター
- 匿名化品質向上のための韓国語NER
- オブジェクトストレージベースのエクスポートキャッシュ
- 論文履歴とデータ保持制御を持つユーザーアカウント
- ジョブスループット・エラー率・レイテンシパーセンタイルの可観測性ダッシュボード

---

## このプロジェクトが重要な理由

Chat Paperは、週末のAIデモを超えたプロダクションパターンを示している。

**非同期パイプライン設計:** システムは、同期HTTPレイヤーと長時間稼働処理レイヤーを耐久性のあるキューで正しく分離している。ジョブの状態は、すべての障害モード（タイムアウト、クラッシュ、Redisの障害、部分完了）に対するリカバリを備えたPostgreSQLベースのステートマシンを通じてアトミックに追跡される。

**セキュリティファーストのAPI設計:** レート制限は多層化されている。Redisのみを使用するIPプリフライトチェックがDB接続前に実行され、未認証トラフィックによるDB DoSを防ぐ。3層アーキテクチャ（プリフライト → ルート制限 → クォータトランザクション）により、各防御が独立して機能する。

**一度だけ実行される保証:** SHA-256冪等性キーをBullMQの`jobId`とPostgreSQLのユニーク制約の両方として使用し、Serializable分離トランザクションを組み合わせることで、重複APIコールが同時負荷下でも正確に1つの論文のみを生成することを保証する。

**優雅な障害処理:** すべての障害パスに定義された結果がある。スタックジョブは2つのパス（PROCESSINGとPENDING）でリカバリされ、アトミックトランザクションが部分書き込みを防止し、ワーカーはFly.ioのSIGKILLウィンドウ内でシャットダウンされる。

**韓国語ファーストの国際化:** プラットフォームはKakaoTalkの韓国語日付形式、LINEのタブ区切りエクスポート、InstagramのJSONスキーマをAI会話ログとともにネイティブに処理する — チャット形式のパースにサードパーティライブラリを一切使用せずに。
