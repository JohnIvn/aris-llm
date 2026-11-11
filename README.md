# ARIS Ollama Railway bridge

This project has two Node.js scripts:

- `host-client.js` runs on the machine that has Ollama. It asks the local Ollama API for an answer, then publishes that answer to Railway.
- `server.js` runs on Railway. It receives responses at `POST /api/llm-response`, returns the latest response at `GET /api/latest`, and publishes responses to connected clients through `GET /api/responses/stream`.

## Deploy the receiver to Railway

1. Create a Railway service from this folder.
2. Railway will use the included `Dockerfile`.
3. Optionally add `RECEIVER_TOKEN` in Railway variables. If set, requests must use the same token.
4. The health endpoint is `GET /health`.

Railway automatically provides `PORT`; the server listens on `0.0.0.0`.

## Send a question from the Ollama host

Requires Node.js 20 or newer and Ollama running locally.

PowerShell:

```powershell
$env:RECEIVER_URL = "https://your-service.up.railway.app"
$env:RECEIVER_TOKEN = "your-token" # omit if not configured
$env:OLLAMA_MODEL = "llama3.2"      # optional
npm run send -- "What is the status of my request?"
```

The host script uses `http://127.0.0.1:11434` by default. Override it with `OLLAMA_URL` if needed.
