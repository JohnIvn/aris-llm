import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const receiverToken = process.env.RECEIVER_TOKEN;
const maxBodyBytes = 1_000_000;
const clients = new Set();
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
  for (const client of clients) {
    client.write(message);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const requestStartedAt = Date.now();
  console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/latest") {
    sendJson(response, 200, { response: latestResponse });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/responses/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    if (latestResponse) {
      response.write(`data: ${JSON.stringify(latestResponse)}\n\n`);
    }
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/llm-response") {
    if (!isAuthorized(request)) {
      console.warn(`[${new Date().toISOString()}] Unauthorized response submission rejected.`);
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
        console.warn(`[${new Date().toISOString()}] Invalid LLM response payload received.`);
        sendJson(response, 400, { error: "question and response are required strings." });
        return;
      }

      latestResponse = {
        id: randomUUID(),
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
      console.error(`[${new Date().toISOString()}] Failed to process LLM response: ${error.message}`);
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  console.warn(`[${new Date().toISOString()}] Route not found: ${request.method} ${url.pathname}`);
  sendJson(response, 404, { error: "Not found." });
  console.log(`[${new Date().toISOString()}] Request completed in ${Date.now() - requestStartedAt}ms.`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] LLM receiver listening on port ${port}`);
  console.log(`[${new Date().toISOString()}] Authentication: ${receiverToken ? "enabled" : "disabled"}`);
});
