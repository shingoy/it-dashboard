# 政府IT会議ダッシュボード

政府各省庁のIT/デジタル関連会議の議事録・資料を横断検索・要約するダッシュボード

## 🚀 Vercel + GitHub セットアップ

### ステップ1: GitHubリポジトリ作成

```bash
# リポジトリを作成
gh repo create gov-it-dashboard --public
cd gov-it-dashboard

# 初期化
git init
```

### ステップ2: プロジェクトファイル配置

以下のディレクトリ構造でファイルを配置：

```
gov-it-dashboard/
├── app/
│   ├── layout.tsx                 # ルートレイアウト
│   ├── page.tsx                   # ホーム（→/dashboard）
│   ├── globals.css                # グローバルスタイル
│   ├── api/
│   │   └── search/
│   │       └── route.ts           # 検索API
│   └── dashboard/
│       └── page.tsx               # メインダッシュボード
├── components/
│   └── ui/
│       └── alert.tsx              # UIコンポーネント
├── lib/
│   └── utils.ts                   # ユーティリティ
├── scripts/
│   ├── crawl.py                   # データ収集
│   ├── extract.py                 # テキスト抽出
│   └── build_index.py             # インデックス生成
├── public/
│   ├── index-shards/              # 検索インデックス（自動生成）
│   ├── trends/                    # トレンドデータ（自動生成）
│   └── docs-meta.json             # ドキュメント一覧（自動生成）
├── .github/
│   └── workflows/
│       └── crawl.yml              # 自動収集ワークフロー
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── requirements.txt               # Python依存関係
├── vercel.json                    # Vercel設定
└── README.md
```

### ステップ3: 初回データ生成（ローカル）

```bash
# Node.js依存関係インストール
npm install

# Python依存関係インストール
pip install -r requirements.txt

# データ収集→抽出→インデックス生成
python scripts/crawl.py
python scripts/extract.py
python scripts/build_index.py

# public/配下にファイルが生成されることを確認
ls public/index-shards/
ls public/trends/
```

### ステップ4: GitHubにプッシュ

```bash
git add .
git commit -m "Initial commit with search index"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gov-it-dashboard.git
git push -u origin main
```

### ステップ5: Vercelデプロイ

#### 方法A: Vercel Dashboard（推奨）

1. https://vercel.com にアクセス
2. 「Add New Project」をクリック
3. GitHubリポジトリ `gov-it-dashboard` を選択
4. Framework Preset: **Next.js** が自動検出される
5. 「Deploy」をクリック

#### 方法B: Vercel CLI

```bash
# Vercel CLIインストール
npm i -g vercel

# ログイン
vercel login

# デプロイ
vercel

# 本番デプロイ
vercel --prod
```

### ステップ6: GitHub Actions設定

1. GitHubリポジトリ → **Settings** → **Actions** → **General**
2. **Workflow permissions** を **Read and write permissions** に変更
3. 保存

これで毎日06:00 JST（前日21:00 UTC）に自動でデータ収集が実行されます。

## 📁 詳細なファイル構成

### Next.jsアプリケーション

```typescript
// app/dashboard/page.tsx
// メインダッシュボードUI（Reactコンポーネント）
// - 検索バー、フィルタ、結果表示、要約パネル

// app/api/search/route.ts
// 検索APIエンドポイント
// - public/index-shards/*.json を読み込み
// - BM25スコアリング
// - フィルタリング、ソート
```

### Pythonスクリプト

```python
# scripts/crawl.py
# 省庁サイトから議事録PDFを収集
# → data/cache/*.pdf
# → data/collected_docs.json

# scripts/extract.py  
# PDFからテキスト抽出、チャンク化
# → data/extracted/*.json

# scripts/build_index.py
# 検索インデックス生成
# → public/index-shards/*.json
# → public/trends/*.json
# → public/docs-meta.json
```

### 静的ファイル（Vercelで配信）

```
public/
├── index-shards/
│   ├── _index.json                    # シャード一覧
│   ├── デジタル社会推進会議_2025-09_0.json
│   ├── AI戦略会議_2025-08_0.json
│   └── ...
├── trends/
│   ├── 2025-09.json                   # 月次トレンド
│   ├── 2025-08.json
│   └── ...
└── docs-meta.json                     # 全ドキュメントメタデータ
```

## 🔄 自動更新フロー

### GitHub Actions（毎日06:00 JST）

```
1. crawl.py 実行
   ↓ 新規PDF検出
2. extract.py 実行
   ↓ テキスト抽出
3. build_index.py 実行
   ↓ インデックス更新
4. public/ に変更があれば自動コミット
   ↓
5. Vercelが自動デプロイ
   ↓
6. 最新データが本番に反映
```

### 手動更新

```bash
# ローカルでデータ更新
python scripts/crawl.py
python scripts/extract.py
python scripts/build_index.py

# GitHubにプッシュ
git add public/
git commit -m "Update search index"
git push

# Vercelが自動でデプロイ
```

## 🛠️ 開発

### ローカル開発サーバー

```bash
npm run dev
# → http://localhost:3000
```

### ビルドテスト

```bash
npm run build
npm start
```

## 📊 データフロー図

```
省庁サイト
    ↓ (crawl.py)
PDF/HTML
    ↓ (extract.py)
抽出テキスト + チャンク
    ↓ (build_index.py)
検索インデックス (public/)
    ↓ (Vercel配信)
ブラウザ
    ↓ (検索クエリ)
API Route (/api/search)
    ↓ (BM25検索)
検索結果
    ↓ (Claude API)
要約生成
```

## 🎯 運用チェックリスト

### 初回セットアップ
- [ ] GitHubリポジトリ作成
- [ ] ローカルでデータ生成（crawl→extract→build_index）
- [ ] public/配下にファイル生成確認
- [ ] GitHubにプッシュ
- [ ] Vercelプロジェクト作成・デプロイ
- [ ] GitHub Actions権限設定（Read and write）

### 定期確認
- [ ] GitHub Actions が正常実行されているか（Actions タブ）
- [ ] 失敗がある場合、Artifactsから `failed-urls-*` 確認
- [ ] public/index-shards/ のファイルサイズ確認（肥大化チェック）

## 🐛 トラブルシューティング

### Vercelビルドエラー

```bash
# ローカルでビルド確認
npm run build

# エラーがあればログを確認
# 多くの場合、TypeScriptの型エラー
```

### GitHub Actions失敗

**原因**: Write権限がない  
**対処**: Settings → Actions → Workflow permissions → Read and write

**原因**: Python依存関係エラー  
**対処**: requirements.txt に必要なパッケージを追加

### 検索結果が0件

**原因**: public/index-shards/ にファイルがない  
**対処**: ローカルで `build_index.py` を実行してプッシュ

### Claude要約が遅い

**原因**: Claude APIの呼び出しは数秒かかります  
**対処**: 正常動作です。キャッシュ機構を追加する場合：

```typescript
// app/api/summarize/route.ts を作成
// Vercel KVでキャッシュ
import { kv } from '@vercel/kv';

const cacheKey = `summary:${queryHash}`;
const cached = await kv.get(cacheKey);
if (cached) return cached;

// Claude呼び出し
const summary = await callClaude(...);
await kv.set(cacheKey, summary, { ex: 3600 }); // 1時間キャッシュ
```

## 📈 スケーリング

### データ量が増えた場合（1000文書以上）

**オプション1**: シャードサイズを小さく

```python
# build_index.py
def create_shards(self, chunks, shard_size: int = 50):  # 100→50
```

**オプション2**: Vercel Postgres移行（要件書の構成②）

```bash
npm install @vercel/postgres
```

## 🔐 セキュリティ

- Claude APIキーは不要（直接呼び出し可能）
- 環境変数設定は不要
- 公開データのみ扱うため認証機構は不要

## 📝 ライセンス

MIT

## 🤝 コントリビューション

Issue、PRを歓迎します！

1. Fork
2. Feature Branch作成
3. Commit
4. Push
5. Pull Request作成
