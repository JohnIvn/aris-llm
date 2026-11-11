const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2";
const receiverUrl = process.env.RECEIVER_URL;
const receiverToken = process.env.RECEIVER_TOKEN;
const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error("Usage: npm run send -- \"your question\"");
  process.exit(1);
}

if (!receiverUrl) {
  console.error("RECEIVER_URL is required.");
  process.exit(1);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${body.error ?? "request failed"}`);
  }
  return body;
}

try {
  const ollamaResponse = await requestJson(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: question,
      stream: false,
    }),
  });

  if (typeof ollamaResponse.response !== "string" || !ollamaResponse.response.trim()) {
    throw new Error("Ollama returned no response text.");
  }

  const headers = { "content-type": "application/json" };
  if (receiverToken) {
    headers.authorization = `Bearer ${receiverToken}`;
  }

  const published = await requestJson(`${receiverUrl.replace(/\/$/, "")}/api/llm-response`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      question,
      response: ollamaResponse.response,
      model: ollamaModel,
    }),
  });

  console.log(JSON.stringify({ ...published, response: ollamaResponse.response }, null, 2));
} catch (error) {
  console.error(`Unable to send LLM response: ${error.message}`);
  process.exit(1);
}
