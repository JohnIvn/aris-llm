import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const receiverToken = process.env.RECEIVER_TOKEN;
const maxBodyBytes = 1_000_000;
const clients = new Set();
const questionQueue = [];
let latestResponse = null;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function isAuthorized(request) {
  return !receiverToken || request.headers.authorization === `Bearer ${receiverToken}`;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function publish(responseData) {
  const message = `data: ${JSON.stringify(responseData)}\n\n`;
  console.log(`[${new Date().toISOString()}] Broadcasting response ${responseData.id} to ${clients.size} client(s).`);
  for (const client of clients) client.write(message);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/latest") {
    sendJson(response, 200, { response: latestResponse });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/questions") {
    if (!isAuthorized(request)) {
      console.warn("Unauthorized question rejected.");
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }
    try {
      const payload = await readJson(request);
      if (typeof payload.question !== "string" || !payload.question.trim()) {
        sendJson(response, 400, { error: "question is required." });
        return;
      }
      const question = {
        id: randomUUID(),
        question: payload.question.trim(),
        createdAt: new Date().toISOString(),
      };
      questionQueue.push(question);
      console.log(`[${question.createdAt}] Question queued from SSH: ${question.question}`);
      sendJson(response, 202, { accepted: true, id: question.id, queued: questionQueue.length });
    } catch (error) {
      console.error(`Failed to queue question: ${error.message}`);
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/questions/next") {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }
    const question = questionQueue.shift() ?? null;
    if (question) console.log(`[${new Date().toISOString()}] Question assigned to host client: ${question.id}`);
    sendJson(response, 200, { question });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/responses/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    if (latestResponse) response.write(`data: ${JSON.stringify(latestResponse)}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/llm-response") {
    if (!isAuthorized(request)) {
      console.warn("Unauthorized response submission rejected.");
      sendJson(response, 401, { error: "Unauthorized." });
      return;
    }
    try {
      const payload = await readJson(request);
      if (
        typeof payload.question !== "string" ||
        typeof payload.response !== "string" ||
        !payload.question.trim() ||
        !payload.response.trim()
      ) {
        sendJson(response, 400, { error: "question and response are required strings." });
        return;
      }
      latestResponse = {
        id: randomUUID(),
        questionId: typeof payload.questionId === "string" ? payload.questionId : undefined,
        question: payload.question.trim(),
        response: payload.response.trim(),
        model: typeof payload.model === "string" ? payload.model : undefined,
        receivedAt: new Date().toISOString(),
      };
      console.log(`[${latestResponse.receivedAt}] Question received: ${latestResponse.question}`);
      console.log(`[${latestResponse.receivedAt}] LLM response (${latestResponse.model ?? "unknown model"}): ${latestResponse.response}`);
      publish(latestResponse);
      sendJson(response, 202, { accepted: true, id: latestResponse.id });
    } catch (error) {
      console.error(`Failed to process LLM response: ${error.message}`);
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  console.warn(`Route not found: ${request.method} ${url.pathname}`);
  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] LLM receiver listening on port ${port}`);
  console.log(`[${new Date().toISOString()}] Authentication: ${receiverToken ? "enabled" : "disabled"}`);
});
