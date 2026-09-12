# 漢字対戦「全単元出題」

既存の `units` とその問題は読み取りのみ。全単元出題専用のコピーを
`kanji_battle_pools/{version}/questions/{連番}` に保存する。
有効版は `kanji_battle_pools/active`。クライアントからの直接読み書きは既存ルールで拒否される。

ルーム作成時に有効版と重複しない10個の連番をサーバーで抽選し、ルームに固定する。
配信・OCR採点は固定した版の10問だけ取得する。既存単元の対戦は従来どおり。

## 問題入れ替え時

通常の問題登録がすべて完了してから、以下を実行する。
このスクリプト自体は元の単元・問題を追加、修正、削除しない。

```powershell
node scripts/build-kanji-battle-pool.js
node scripts/build-kanji-battle-pool.js --apply
```

最初は読み取り専用の件数確認。`--apply` は新しい版を生成し、全コピーの内容と件数、
コピー前後の元データ更新時刻を照合してから有効版を切り替える。
不正な問題や生成中の元データ変更があれば切替を中止する。
Firebase CLI の既存ログイン、または `GOOGLE_APPLICATION_CREDENTIALS` を利用する。
秘密情報は出力・コピーしない。

旧版は進行中対戦・採点のため自動削除しない。更新が低頻度のため履歴として保持する。
将来削除する場合も、該当版を参照する未処理対戦がないことを確認して専用コピーだけ削除する。
同じ内容が複数単元に登録されていれば、それぞれ独立した登録問題として抽選対象になる。
画像は既存URLを参照するため、旧版の対戦が終わるまで元の画像ファイルも保持する。

## 検証

```powershell
npm.cmd run test:kanji-battle
npm.cmd run test:security
npx.cmd tsc --noEmit
```
