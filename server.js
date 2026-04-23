import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        model: OPENAI_MODEL,
        configured: Boolean(OPENAI_API_KEY)
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error."
    });
  }
});

server.on("listening", () => {
  console.log(`Lexora AI server running at http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not set. /api/chat will return a setup error until it is configured.");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT to another value and restart.`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT);

async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, {
      error:
        "OPENAI_API_KEY не задан. Добавьте ключ в переменные окружения или в локальный .env файл."
    });
    return;
  }

  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const scenario = typeof body.scenario === "string" ? body.scenario : "consultation";
  const jurisdiction = typeof body.jurisdiction === "string" ? body.jurisdiction : "Не указана";
  const threadLabel = typeof body.threadLabel === "string" ? body.threadLabel : "Юридический запрос";

  const input = [
    {
      role: "system",
      content: buildSystemPrompt({ scenario, jurisdiction, threadLabel })
    },
    ...messages
      .filter(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string"
      )
      .map((message) => ({
        role: message.role,
        content: message.content
      }))
  ];

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input
    })
  });

  const data = await apiResponse.json();

  if (!apiResponse.ok) {
    const apiError =
      data?.error?.message || "OpenAI API returned an error while generating the response.";
    sendJson(res, apiResponse.status, { error: apiError });
    return;
  }

  const reply = extractText(data);
  sendJson(res, 200, {
    reply,
    model: data.model || OPENAI_MODEL
  });
}

function buildSystemPrompt({ scenario, jurisdiction, threadLabel }) {
  return [
    "You are Lexora AI, a legal intake assistant for Lexora Law.",
    "Always reply in Russian unless the user clearly asks for another language.",
    "This is an informational draft for lawyer review, not final legal advice.",
    `Current thread: ${threadLabel}.`,
    `Scenario: ${scenario}.`,
    `Jurisdiction context: ${jurisdiction}.`,
    "Be careful, practical, and concise.",
    "Structure your response with these sections:",
    "## Первичный вывод",
    "## Что важно",
    "## Что уточнить",
    "## Следующий шаг",
    "## Дисклеймер",
    "Use bullet points where useful.",
    "Do not claim certainty about laws or court outcomes when facts are incomplete.",
    "Remind the user that a lawyer should verify the final position."
  ].join("\n");
}

async function serveStatic(requestPath, res) {
  const safePath = normalizePath(requestPath);
  const filePath = path.join(__dirname, safePath === "/" ? "index.html" : safePath.slice(1));

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      sendNotFound(res);
      return;
    }

    const ext = path.extname(filePath);
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    sendNotFound(res);
  }
}

function normalizePath(requestPath) {
  if (requestPath === "/" || requestPath === "") {
    return "/";
  }

  const normalized = path.posix.normalize(requestPath);
  if (normalized.includes("..")) {
    return "/";
  }

  return normalized;
}

function sendNotFound(res) {
  sendJson(res, 404, { error: "Not found." });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function extractText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) {
    return "Модель вернула ответ без текста.";
  }

  const parts = [];
  for (const item of data.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim() || "Модель вернула ответ без текста.";
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
