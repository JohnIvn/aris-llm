# ARIS Ollama Railway bridge

This project has two Node.js scripts:

- `host-client.js` runs continuously on the machine that has Ollama. It does not create questions. It polls Railway for questions created by SSH, mobile, or another client, asks local Ollama, then publishes only the answer back to Railway.
- `server.js` runs on Railway. It queues SSH questions at `POST /api/questions`, receives responses at `POST /api/llm-response`, and publishes responses through `GET /api/responses/stream`.

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
npm run worker
```

The host script uses `http://127.0.0.1:11434` by default. Override it with `OLLAMA_URL` if needed.

Keep the worker running on the Ollama machine. From the Railway SSH console, another client, or your mobile app, queue a question:

```sh
Q "What is the status of my request?"
```

The worker receives the question, Ollama generates the answer, and the answer appears in Railway deployment logs.

`Q` automatically uses the `RECEIVER_TOKEN` Railway variable when authentication is enabled.

The worker is started with:

```powershell
npm run worker
```

Do not pass a question to `host-client.js`; questions must be sent to Railway through `POST /api/questions`.
