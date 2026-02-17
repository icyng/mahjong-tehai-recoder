# Kifu API

## Run

```bash
cd apps/kifu_api
uv run --project ../.. uvicorn app.main:app --reload --port 8000
```

開発時はルートから以下でも起動可能

```bash
uv run apps/tehai_recorder.py api
```

## Endpoints

- `GET /health`
- `GET /kifu/sample`
- `POST /kifu/validate`
- `POST /analysis/hand`
- `POST /analysis/tenpai`
- `POST /analysis/tiles-from-image`
- `POST /api/capture`
