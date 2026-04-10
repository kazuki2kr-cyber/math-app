---
name: ab-test-analysis
description: A/Bテスト分析のフレームワーク。教育アプリにおける問題出題順序、UI変更、学習アルゴリズムの効果を統計的に検証する際に使用します。
---

## A/Bテスト分析の概要
教育アプリにおいて、教授法や問題配置の変更が学習効果に与える影響を定量的に測定するためのフレームワークです。

## 教育アプリでの適用例
1. **問題出題順序**: ランダム vs 難易度順 の正答率比較
2. **フィードバック表示**: 即時フィードバック vs まとめて表示 の学習効果比較
3. **弱点克服モード**: 相関ベースのレコメンド vs 通常復習 の効果比較

## 統計的有意性の検証

### 二項検定（正答率の比較）
```typescript
// フィッシャーの正確検定に近似する計算
function significanceTest(
  correctA: number, totalA: number,
  correctB: number, totalB: number
): { pValue: number; isSignificant: boolean; effectSize: number } {
  const rateA = correctA / totalA;
  const rateB = correctB / totalB;
  const pooledRate = (correctA + correctB) / (totalA + totalB);
  const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1/totalA + 1/totalB));
  const z = (rateA - rateB) / se;
  // 近似p値（両側検定）
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  return {
    pValue,
    isSignificant: pValue < 0.05,
    effectSize: rateA - rateB
  };
}
```

### サンプルサイズの確認
- 最低 n=30/グループ を目標
- 検出力80%、有意水準5%で計算
