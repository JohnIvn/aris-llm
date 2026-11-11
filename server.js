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
  for (const client of clients) {
    client.write(message);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

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
        question: payload.question.trim(),
        response: payload.response.trim(),
        model: typeof payload.model === "string" ? payload.model : undefined,
        receivedAt: new Date().toISOString(),
      };
      publish(latestResponse);
      sendJson(response, 202, { accepted: true, id: latestResponse.id });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`LLM receiver listening on port ${port}`);
});
