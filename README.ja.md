# Chat Paper

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

KakaoTalkの会話とAI会話を学術論文ドラフトに変換する、韓国語ファーストのAI SaaSです。

![Chat Paper ホーム](docs/screenshots/home-dark.png)

## 概要

Chat Paperは会話データをアップロードし、流れとトーンを分析して、研究ダッシュボードと論文リーダーにつながる学術スタイルのドラフトを生成します。

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

## 特徴

- ダークモードと `KO / JA / EN` 切り替えに対応した韓国語ファーストのプレミアムUI
- KakaoTalk と AI 会話のアップロードフロー
- 会話の解析と分析パイプライン
- 構造と使用言語をすばやく把握できる研究ダッシュボード
- エクスポート操作を備えた論文リーダー
- Next.js App Router、Prisma、OpenAI による構成

## 技術スタック

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma + PostgreSQL
- OpenAI API

## クイックスタート

```bash
npm install
npm run db:generate
npm run db:push
npm run dev
```

Prismaコマンドと開発サーバー起動の前に、`.env.example` を `.env.local` にコピーしてください。

[http://localhost:3000](http://localhost:3000) を開いてください。

## 環境変数

`.env.example` をコピーして `.env.local` を作成します。

```bash
OPENAI_API_KEY=
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## 主なルート

- `/` ランディング
- `/upload` アップロードと分析の開始
- `/result?paperId=...` 研究ダッシュボード
- `/paper/[paperId]` 論文リーダー

## メモ

- 結果ページと論文リーダーは、既定ではブラウザ単位のゲストセッションクッキーに紐づきます。
- Google OAuthは任意で、標準のアップロードフローには不要です。
- Prismaコマンドを実行するにはローカルのPostgreSQLが起動している必要があります。
