# 麻雀記録app

ブラウザから牌譜入力を行うツール

## 機能

- 画像解析による初期手牌入力
- 副露・聴牌・和了判定
- 役・点数計算
- ログ出力（天鳳対応）

## 環境

mac での動作を想定：

```bash
> python --version
3.10.8

# cuda使用時
> uv pip list
torch==2.7.1+cu118
torchaudio==2.7.1+cu118
torchvision==0.22.1+cu118
```

## Setup（開発）

```bash
uv sync
uv pip install -e .
cd apps/kifu_ui && npm ci
```

## 起動（開発）

`tehai_recorder` をlauncherとして利用

```bash
uv run apps/tehai_recorder.py dev
```

## 補足

- NAS 運用想定の Docker 構成手順は `deploy/README.md` を参照すること
- 学習/検証向けの補助スクリプトやデータセットは非公開
