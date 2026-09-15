# 問題別アイコン報酬

問題CSVの各行に報酬設定を加えると、条件達成時に限定アイコンをユーザーへ永久付与できます。付与判定は Cloud Functions の採点確定トランザクション内で行い、同じ `reward_icon_id` は一度だけ解放されます。

## CSV列

| 列 | 内容 |
|---|---|
| `reward_icon_id` | 報酬を識別する英小文字・数字・`-`・`_`。複数問題で共有可能 |
| `reward_icon_name` | 生徒と管理画面に表示する名称 |
| `reward_icon_image_url` | `public/images/reward-icons/` 配下の画像URL |
| `reward_condition_type` | 現在は `written_score_at_least` |
| `reward_condition_value` | 解放に必要な記述式スコア（0〜100） |

例:

```csv
reward_icon_id,reward_icon_name,reward_icon_image_url,reward_condition_type,reward_condition_value
equation-writing-master,方程式記述マスター,/images/reward-icons/equation-writing-master.webp,written_score_at_least,100
```

同じ報酬IDを複数の問題へ設定すると、そのうちどれか一つで条件を満たした時点で同じアイコンが解放されます。問題ごとに別のアイコンを付与する場合は、異なる報酬IDと画像を設定します。

## 画像仕様

- PNG、WebP、AVIFに対応
- 透過背景の正方形を推奨
- 表示サイズは小さいため、256×256px程度で十分
- ファイル名は英数字・`-`・`_`を推奨
- 外部URLは使用不可。任意サイトへの追跡通信や画像差し替えを防ぐため、アプリ同梱画像だけを許可する

## セキュリティ

- 解放状態は `users/{uid}.unlockedIcons` にサーバーだけが保存する
- アイコン選択は `setUserIcon` Callable Function が、レベルまたは実績による所有を検証する
- クライアントから `users/{uid}.icon` を直接変更することは Firestore Rules で禁止する
- 記述式イベントの成績リセット後も、一度獲得したアイコンは保持する

