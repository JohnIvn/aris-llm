const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.2";
const receiverUrl = process.env.RECEIVER_URL;
const receiverToken = process.env.RECEIVER_TOKEN;
const question = process.argv.slice(2).join(" ").trim();

if (!receiverUrl) {
  console.error("RECEIVER_URL is required.");
  process.exit(1);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${body.error ?? "request failed"}`);
  return body;
}

function receiverHeaders() {
  const headers = { "content-type": "application/json" };
  if (receiverToken) headers.authorization = `Bearer ${receiverToken}`;
  return headers;
}

async function askOllama(prompt) {
  const result = await requestJson(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
  });
  if (typeof result.response !== "string" || !result.response.trim()) {
    throw new Error("Ollama returned no response text.");
  }
  return result.response.trim();
}

async function sendResponse(questionData, answer) {
  return requestJson(`${receiverUrl.replace(/\/$/, "")}/api/llm-response`, {
    method: "POST",
    headers: receiverHeaders(),
    body: JSON.stringify({
      questionId: questionData.id,
      question: questionData.question,
      response: answer,
      model: ollamaModel,
    }),
  });
}

async function runWorker() {
  console.log(`Host worker started. Polling ${receiverUrl} for questions.`);
  while (true) {
    try {
      const result = await requestJson(`${receiverUrl.replace(/\/$/, "")}/api/questions/next`, {
        headers: receiverHeaders(),
      });
      if (!result.question) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      console.log(`Question received: ${result.question.question}`);
      const answer = await askOllama(result.question.question);
      await sendResponse(result.question, answer);
      console.log(`Response sent to Railway: ${answer}`);
    } catch (error) {
      console.error(`Worker error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function runOneQuestion() {
  if (!question) {
    console.error('Usage: npm run send -- "your question" or npm run worker');
    process.exit(1);
  }
  const answer = await askOllama(question);
  const published = await sendResponse({ question }, answer);
  console.log(JSON.stringify({ ...published, response: answer }, null, 2));
}

try {
  if (process.argv[2] === "--worker") await runWorker();
  else await runOneQuestion();
} catch (error) {
  console.error(`Unable to send LLM response: ${error.message}`);
  process.exit(1);
}
