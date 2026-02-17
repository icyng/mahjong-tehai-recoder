# 配布向け Docker 運用（Synology RS822+ 想定）

非エンジニア利用者には、NAS上で常時起動した Web へブラウザアクセスしてもらう構成を想定しています。

## 構成

- `web`:
  - React UI の静的配信（Nginx）
  - `/analysis/*` と `/kifu/*` を `api` へプロキシ
- `api`:
  - FastAPI (`/analysis/hand`, `/analysis/tenpai`, `/analysis/tiles-from-image`)
  - YOLO 推論（`mj/models/tehai/weights/best.pt` 利用）

## 初回セットアップ

1. リポジトリを NAS に配置（Git clone でも zip 展開でも可）
2. 画像解析を使う場合は、推論モデル `best.pt` を配置:

```text
mj/models/tehai/weights/best.pt
```

3. プロジェクトルートで実行:

```bash
docker compose up -d --build
```

4. ブラウザでアクセス:

```text
http://<NASのIP>:8080
```

## 更新（GitHub運用）

GitHub で更新後、NAS で以下を実行:

```bash
git pull
docker compose up -d --build
```

## 監視・停止

```bash
docker compose ps
docker compose logs -f
docker compose down
```

## 補足

- 画像解析は CPU 推論なので、同時利用が多いと遅くなる可能性があります。
- 反応が遅い場合は、`api` を別の常時ON PCへ分離する構成（UIはNAS）も有効です。

## 公開前チェック（GitHub運用）

- 学習用データ/学習成果物は公開リポジトリに含めない運用を推奨:
  - `mj/models/tehai/dataset/`
  - `mj/models/tehai/runs_mj/`
  - `mj/models/tehai/showcase/`
  - `mj/models/tehai/yolov12*.pt`
- ランタイムで必要な重みは `mj/models/tehai/weights/best.pt` のみです。
- 既に過去コミットへ含めたファイルは `.gitignore` では消えないため、必要なら履歴クリーンアップ（`git filter-repo`）を実施してください。

## 補助スクリプト

- 学習資産を別領域へ移動:

```bash
bash scripts/move_private_assets.sh /path/to/private-assets
```

- 公開用に履歴をクリーン化した mirror を生成:

```bash
bash scripts/rewrite_history_public.sh /tmp/mj-cli-public.git
```
