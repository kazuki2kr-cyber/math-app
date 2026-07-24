# PC Migration Guide — math.app

このガイドは、`math.app` フォルダを安全な方法で新PCへコピーした後、Codex に一言依頼するだけで開発環境の診断・再構築・再認証・検証まで進めてもらうための手順です。

## Codex への依頼文

新PCでコピー済みの `math.app` フォルダを Codex Desktop で開き、次のように依頼してください。

```text
新PCへ移行したから対応して。
```

`AGENTS.md` に移行依頼の自動実行ルールがあるため、長い手順を再度説明する必要はありません。Codex はこのガイドを読み、後述の「新PCでの Codex 実行手順」を完了まで進めます。

## 今回の移行前提

- Git 管理ファイルだけでなく、作業中の未コミットファイルも含めて `math.app` フォルダ全体をコピーする
- `.env.local`、`functions/.env`、`.vercel/project.json` などの Git 管理外ファイルも、安全な暗号化済み媒体または安全な転送経路でそのままコピーする
- 秘密ファイルは新PCで再生成せず、コピーした内容を保持する
- `node_modules`、`.next`、`functions/node_modules`、`functions/lib` などの生成物はコピーしてもよいが、新PCではロックファイルから再構築する
- GitHub、Firebase、Vercel のログイン資格情報は通常このフォルダの外に保存されるため、秘密ファイルとは別に新PCで再認証する

## 旧PCでコピー前に行うこと

### 1. 作業状態を残す

```powershell
git status --short
git branch --show-current
git remote -v
```

未コミット変更もフォルダコピーで移行できます。コピー中にファイルが変わらないよう、開発サーバー、テスト、エディターの保存処理を止めてからコピーしてください。

### 2. 必須ローカルファイルを確認する

値を表示せず、存在だけを確認します。

```powershell
Test-Path .env.local
Test-Path functions/.env
Test-Path .vercel/project.json
```

このプロジェクトでは `.env.local` と `functions/.env` を移行対象にします。`.vercel/project.json` は Vercel CLI を利用する場合のプロジェクト連携情報で、なくても GitHub `main` push による通常デプロイは可能です。

サービスアカウント鍵、`*.pem`、`*.key` などを別途利用している場合も、Git に追加せず、同じ安全な経路で移してください。

### 3. コピー対象を確認する

フォルダ全体をコピーする場合も、次の生成物は新PCで再生成できるため除外可能です。

- `node_modules`
- `.next`
- `functions/node_modules`
- `functions/lib`
- `coverage`
- `playwright-report`
- `test-results`
- `.tmp`

`.git`、`.agents`、`.codex`、`docs`、`scripts`、`.env.local`、`functions/.env` はコピーしてください。

### 4. 安全に転送する

- BitLocker 等で暗号化された外部ストレージ、暗号化アーカイブ、または組織で許可された暗号化転送手段を使う
- 秘密値や認証トークンをチャット、メール本文、Git commit に貼らない
- 新PCへコピー後、不要になった一時アーカイブは安全に削除する
- 旧PCを手放す場合は、移行確認後に端末の標準手順でアカウントとディスクを消去する

Firebase CLI、Git Credential Manager、Vercel CLI の資格情報フォルダを手作業でコピーする必要はありません。新PCで公式ログインフローを使う方が安全です。

## 新PCでの Codex 実行手順

この節は、新PCで移行依頼を受けた Codex が実行する手順です。案内だけで終了せず、ユーザー操作が必要な認証以外は実際に進めてください。

### 1. ルールと作業状態を確認する

1. `AGENTS.md`、`.agents/GUIDELINES.md`、このファイルを読む
2. `git status --short`、現在ブランチ、`origin` を確認する
3. コピーされてきた未コミット変更をユーザーの作業として保持する
4. `.env.local` と `functions/.env` を上書き・再生成・表示しない

### 2. 読み取り専用の事前診断を実行する

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-new-pc.ps1 -Mode check
```

この診断は次を確認します。

- Git、Node.js 22、npm、JDK 21 以上
- `JAVA_HOME` が JDK 21 以上を指していること
- Git の `origin` とブランチ
- `.env.local` と `functions/.env` の存在、必須キー、空値（値は表示しない）
- `.vercel/project.json` の有無

終了コード `2` の場合は、表示された不足を解消してから再実行します。ツールのインストールに管理者権限やユーザー承認が必要なら、その操作だけ確認を求めてください。

### 3. 不足ツールを導入する

必要なバージョンは次のとおりです。

- Git for Windows
- Node.js 22（`.nvmrc` と `functions/package.json` に固定）
- npm
- JDK 21 以上

Java は `java -version` が 21 以上になるだけでなく、ユーザー環境変数 `JAVA_HOME` も同じ JDK のルートへ設定します。環境変数を変更した場合は、新しいターミナルで診断を再実行してください。

Firebase CLI はルートの `package-lock.json` からローカル依存として入るため、別途グローバルインストールする必要はありません。PowerShell の実行ポリシーで `npm.ps1` が拒否された場合は `npm.cmd` を使います。

### 4. 依存関係を再導入して検証する

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-new-pc.ps1 -Mode setup
```

このコマンドは、順番に次を実行します。

1. ルートで `npm.cmd ci`
2. `functions` で `npm.cmd ci`
3. 文字化けチェック
4. Next.js 本番ビルド
5. Cloud Functions TypeScript ビルド
6. Firebase Emulator を使うユニットテスト
7. Firestore セキュリティルールテスト

依存関係の導入が済んでおり検証だけを再実行する場合は `-Mode verify` を使います。緊急時には `-SkipTests` も指定できますが、移行完了条件を満たすには後でテストを実行してください。

### 5. 新PC固有の認証を確認する

認証情報や秘密値を出力せず、次を確認します。

```powershell
git ls-remote origin HEAD
npx.cmd --no-install firebase login:list
npx.cmd --no-install firebase projects:list
```

- GitHub 接続に失敗した場合は、Git Credential Manager または利用中の公式認証フローでログインする
- Firebase が未ログインなら `npx.cmd --no-install firebase login` を実行し、ブラウザでユーザー本人に承認してもらう
- Firebase の一覧に `math-app-26c77` があることを確認する
- Vercel CLI を使う場合だけ `npx.cmd vercel whoami` を確認し、必要なら `login` / `link` する
- 通常のフロントエンドデプロイは GitHub `main` push による Vercel 自動デプロイなので、Vercel CLI 認証は必須ではない

ログイン用URL、ワンタイムコード、トークン、`.env` の値を Codex の回答に転載しないでください。ブラウザ操作が必要な時点で、ユーザーへ短く操作を依頼します。

### 6. 開発サーバーを確認する

```powershell
npm.cmd run dev
```

起動ログに致命的エラーがないことと、ローカル画面が表示できることを確認してサーバーを停止します。ブラウザ確認ができない環境では、起動成功までを確認し、未確認部分を明記します。

## 秘密ファイルの取り扱い

- `.env.local` と `functions/.env` は `.gitignore` 対象のままにする
- 診断ではキー名と空値だけを確認し、値は表示しない
- コピー済みファイルがある限り、Vercel/Firebase から値を再取得して上書きしない
- 不足キーが見つかった場合も、値をチャットへ貼らせず、旧PCの原本または各サービスの安全な設定画面で補う
- `NEXT_PUBLIC_` の値はクライアントへ配布され得る設定であり、真のサーバー秘密を置かない
- `GEMINI_API_KEY`、テストユーザー認証情報、アクセス用パスワードは特に画面出力しない

## 対象サービスと固定情報

- GitHub repository: `https://github.com/kazuki2kr-cyber/math-app.git`
- Firebase project: `math-app-26c77`
- Frontend production: `https://math-app-sooty.vercel.app/`
- Node.js: 22
- Java: JDK 21 以上

Firebase のデプロイを行う場合は、対象事故を防ぐため必ずプロジェクトを明示します。

```powershell
npx.cmd --no-install firebase deploy --project math-app-26c77 --only functions
npx.cmd --no-install firebase deploy --project math-app-26c77 --only firestore:rules,database
```

移行セットアップ中は、確認目的で本番デプロイを実行しないでください。

## 移行完了条件

- コピーされてきた Git 差分を把握し、意図せず変更・破棄していない
- Node.js 22、npm、Git、JDK 21+、`JAVA_HOME` が正しく設定されている
- `.env.local` と `functions/.env` が元のまま存在し、必須キーの診断に通る
- ルートと `functions` の `npm ci` が完了している
- 文字化けチェック、Next.js build、Functions build、ユニットテスト、セキュリティルールテストが通る
- GitHub への読み取り接続を確認済み
- Firebase にログイン済みで `math-app-26c77` へアクセスできる
- Vercel CLI を使う場合だけ Vercel のログイン・link を確認済み
- 開発サーバーが起動し、ローカル画面を確認できる

Codex は最後に、完了した項目、ユーザー操作が必要で残った項目、実行できなかった検証だけを簡潔に報告してください。
