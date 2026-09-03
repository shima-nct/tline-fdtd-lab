# 1次元FDTD 伝送線路ラボ

伝送線路を微小セルに分割し、電圧と電流をYee格子上で交互に更新するブラウザ用シミュレーターです。

公開版: https://tline-fdtd-lab.shima207289.chatgpt.site

## 主な機能

- パルス、ステップ、正弦波、ガウス波
- 整合、開放、短絡、任意抵抗終端
- 電圧・電流の空間分布と固定点の時間履歴
- 前進波・後進波（V⁺、V⁻、I⁺、I⁻）の分離表示
- ½ステップ更新と長押し連続更新
- R′、L′、G′、C′、セル数、Courant数の設定
- 可変ホールド時間の電圧包絡線
- 微小セルの等価回路と要素値表示

## 構成

- `dist/fdtd-core.mjs`: FDTD計算核
- `dist/app.mjs`: 操作・描画処理
- `dist/index.html`: 画面
- `dist/styles.css`: スタイル
- `tests/fdtd-core.test.mjs`: 数値試験

## ローカル実行

```bash
python3 -m http.server 8000 -d dist
```

ブラウザで http://127.0.0.1:8000/ を開きます。

## 数値試験

```bash
node tests/fdtd-core.test.mjs
```
