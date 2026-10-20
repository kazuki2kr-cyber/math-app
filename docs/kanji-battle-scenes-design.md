# 漢字対戦：ロビー・対戦・結果のデザイン

2026-10-20。トップの夜の和風アリーナ、濃紺・青緑・金の配色を引き継ぐ。

## 画面

- 待機：既存アリーナ背景を再利用。参加者・空席・ホスト・自分・準備状態を表示し、準備と開始は従来の条件を維持。
- 対戦：アリーナ内部の背景。背景は静止画のCSS疑似要素で入力対象外。固定背景・動画・パーティクル・追加タイマー・ぼかしフィルタは使用しない。
- 問題・手書き：不透明な白い回答カード。手書きCanvasの実装、縦横比、ペン幅、色、入力条件、画像合成と送信を維持。戻す・クリア・回答の操作対象は高さ44px以上。
- 結果：表彰ステージ背景。順位・スコア・XPの直後にランキングを配置し、その後に全問題の振り返りを表示。長い問題文を省略しない。結果確定前は勝利表記を表示しない。
- 配色とスタイルは漢字対戦の専用CSS Moduleだけで管理。数学・通常の漢字モードの共通コンポーネントは変更しない。

## 画像生成

組み込み image_gen を使用（CLI不使用）。`public/images/kanji-battle/arena.webp` を世界観の参照画像に指定し、別視点の画像を生成。

- 対戦：`public/images/kanji-battle/arena-interior.webp`、1280×720、170,552 bytes。
- 結果：`public/images/kanji-battle/ceremony.webp`、1440×810、230,320 bytes。

対戦用プロンプト：

> Use case: stylized-concept. Create a wide landscape background artwork for a Japanese calligraphy multiplayer game, matching the reference image's world, architecture, navy and teal night sky and golden lantern lighting. Reference image is style and setting only. New view: standing INSIDE the circular stone arena at ground level, symmetrical traditional Japanese timber galleries surrounding the stage, golden lanterns at left and right edges, large celestial golden ring in the sky beyond. Center intentionally dark, calm and spacious behind a real HTML handwriting question card. Environment only, no characters, no words, no letters, no weapons, no UI, no watermarks. Painterly polished mobile game environment, strong atmospheric depth. Wide 16:9 landscape. No motion effects.

結果用プロンプト：

> Use case: stylized-concept. Wide landscape background art for the results awards ceremony of a Japanese calligraphy multiplayer game. Reference image is style and world reference only. Reimagine the same beautiful traditional timber Japanese arena at night as a warm celebratory award pavilion: a small elegant central stone dais, glowing golden celestial ring overhead, symmetrical hanging lanterns, gold-accented banners without writing, subtle golden confetti at the far edges. Color palette midnight indigo and teal with luminous warm gold. Center kept dark enough behind actual HTML results typography, detailed architecture at the sides. Motivating and respectful for all participants, no people, no trophy letters, no numbers, no text, no UI, no watermarks, no weapons. Polished painterly mobile game environment, wide 16:9 composition. Static atmosphere.

## 検証

既存の2人対戦E2Eに、ロビー空席・スマホの横はみ出し・回答カードの不透明白背景・結果の問題別内訳の表示確認と各画面のスクリーンショットを追加。既存の10問すべての筆跡画像、回答時間、採点結果確定の検査を維持する。Quality CIにも漢字対戦E2Eの実行ステップを追加する。ローカル実行結果とCI実行結果は区別して報告する。

ローカル結果：フロントビルド、型チェック、対象Lint、文字化け検査、漢字対戦専用E2E成功。スクリーンショット保存を追加した再実行も成功（1件、約1.8分）。外部Vision境界のみ既存テストで代替し、ルーム作成・参加・準備・開始・回答・確定は実際のエミュレータを使用。CIでの実行および本番公開は未実施。
