# Docker （Synology RS822+ 想定）

NASで常時起動したWebへアクセスする構成

## 構成

- `web`:
  - React + Nginx
  - `/analysis/*` と `/kifu/*` を `api` へプロキシ
- `api`:
  - FastAPI (`/analysis/hand`, `/analysis/tenpai`, `/analysis/tiles-from-image`)
  - YOLO 推論（`mahjong_runtime/weights/best.pt` 利用）

## 初回セットアップ

1. リポジトリを NAS に配置（Git clone でも zip 展開でも可）
2. 画像解析を使う場合は、`pt` 形式推論モデル を配置
3. プロジェクトルートで実行: `docker compose up -d --build`
4. `http://<NAS_IP>:8080`

## 更新（GitHub）

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

- 画像解析はCPU推論のため、同時利用で遅くなる可能性あり
- 反応が遅い場合は、`api` を別の常時ON PCへ分離する構成（UIはNAS）も有効
