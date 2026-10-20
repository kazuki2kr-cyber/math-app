# 漢字対戦トップ デザイン

2026-10-20。トップ画面のみの確認版。待機・対戦・結果画面は対象外。

- 夜の和風アリーナ、墨色・青緑・金色を基調とする。
- 作成と参加を大きな日本語ボタンで提示。選択後は対象欄へフォーカスとスクロールを移す。
- モバイルではボタンを縦並びにし、戦績は3列で表示する。
- 背景画像に文字や操作部品を含めず、実際のテキストとボタンをHTMLで表示する。
- 既存の作成・参加・復帰処理、ランク、戦績、ランキング、シーズン履歴を維持する。
- アニメーション低減設定に対応。装飾画像は読み上げ対象から除外する。
- 戦績・ランキング・過去シーズン・単元選択のカードは濃紺と青緑に統一。本文は明るい白、補足は青みのある明るいグレー、見出し・スコア・ボタンは金色を使用する。金色ボタンの文字は濃色にして視認性を確保する。
- 配色のCSS変数は漢字対戦トップのCSS Module内に閉じ、共通Card・Buttonやグローバルテーマは変更しない。通常の漢字モードや数学のカードには適用しない。

## 画像

生成方法: 組み込みの image_gen（CLI不使用）。最終アセット: `public/images/kanji-battle/arena.webp`（1600 × 735、204,116 bytes）。元画像からWebPに最適化。

生成プロンプト:

> Use case: stylized-concept. Asset type: decorative wide background artwork for a Japanese kanji multiplayer game's home screen. Primary request: An inviting night-time Japanese calligraphy tournament arena, stylized high quality mobile game environment illustration. A circular stone platform, warm golden lanterns, floating blank paper talismans and subtle teal magical ink wisps, deep indigo sky, distant traditional rooftops, a glowing amber ring behind the arena. Wide landscape composition, atmospheric depth, detailed architecture toward the right half, the left half dark and quiet with open negative space for real HTML headings and buttons. Palette deep ink navy, teal, warm gold and pale parchment. Sophisticated and motivating for middle school students, no combat weapons, no characters, no text, no letters, no UI, no logo, no watermark. The artwork is a decorative background only; keep center-left subdued for accessible text overlay.

## 検証の範囲

ローカルで表示・出題範囲選択・募集ルーム一覧への切り替えを確認する。実ルーム作成や参加を伴う対戦の全工程は、公開前に既存の `tests/e2e/kanji-battle.spec.ts` をエミュレータで実行し、Quality CIの対象にも含める必要がある。現在のQuality CIは計算用紙のシナリオのみが対象であり、漢字対戦の成功を示すものではない。
