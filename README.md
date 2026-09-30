# VentLab — 人工呼吸器シミュレーター

医師・RST（呼吸サポートチーム）向けの、人工呼吸器の学習用 Web シミュレーターです。
単一コンパートメント肺モデル（Paw = R·F + V/C − Pmus）を 1 ms 刻みで計算し、波形・非同調・auto-PEEP を設定と患者パラメータから再現します。

## 主な機能

- 換気モード：VC-AC / PC-AC / VC-SIMV / PC-SIMV / CPAP・PSV（無呼吸バックアップ換気つき）
- 圧・流量・換気量の波形、P-V / F-V ループ、肺のアニメーション
- 実測値（PIP・Pplat・ΔP・Cstat・Raw・auto-PEEP・RSBI など）、吸気／呼気ホールド
- 病態プリセット（正常・ARDS・COPD・喘息など）と急変イベント（痰貯留・気胸・回路外れなど）
- 非同調の自動検出（トリガー不発・ダブルトリガー・オートトリガー・早すぎる/遅すぎるサイクル・流量不足）
- アラーム（上限圧・低圧・回路外れ・無呼吸・VTe/MVe 上下限など）
- 血液ガス推定（pH・PaCO₂・PaO₂・SpO₂・EtCO₂・P/F）
- シナリオ 8 題（クイズ＋設定調整の課題、採点、学習記録は端末内保存）
- ダーク／ライトテーマ、PC・タブレット・スマートフォン対応

## ローカルで動かす

Node.js が必要です（ビルド不要の静的サイト）。

```bash
npm run dev
```

ブラウザで http://localhost:8787 を開きます。

## 構成

```
public/
  index.html
  css/style.css
  js/engine.js     呼吸器・肺の物理エンジン、非同調判定
  js/gas.js        血液ガス推定モデル
  js/alarms.js     アラーム
  js/scenarios.js  シナリオと採点・学習記録
  js/charts.js     波形・ループ描画
  js/lung.js       肺アニメーション
  js/help.js       解説テキスト
  js/main.js       画面の組み立て
serve.mjs          開発用サーバー
```

## 注意

教育用シミュレーションです。簡略化したモデルを用いており、実際の臨床判断には使用しないでください。
