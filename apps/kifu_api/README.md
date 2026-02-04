# Kifu API

## Run

```bash
cd apps/kifu_api
uv run --project ../.. uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /health`
- `GET /kifu/sample`
- `POST /kifu/validate`
- `POST /analysis/hand`
