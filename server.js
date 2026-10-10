require("dotenv").config();

const express = require("express");
const path = require("path");
const {
  createSession,
  processCustomerUtterance,
  getSystemPrompt,
  getSession
} = require("./src/agent");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Home Credit LAP Voice Agent Demo" });
});

app.get("/api/system-prompt", (_req, res) => {
  res.type("text/plain").send(getSystemPrompt());
});

app.post("/api/session", (req, res) => {
  const session = createSession(req.body || {});
  res.status(201).json({
    sessionId: session.id,
    reply: session.lastReply,
    status: session.status,
    state: publicState(session)
  });
});

app.post("/api/session/:id/message", (req, res) => {
  const utterance = req.body && req.body.customer_utterance;
  if (typeof utterance !== "string" || !utterance.trim()) {
    return res.status(400).json({ error: "customer_utterance must be a non-empty string." });
  }
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found." });

  const result = processCustomerUtterance(session.id, utterance);
  return res.json({
    reply: result.reply,
    status: result.status,
    state: publicState(result.session)
  });
});

app.get("/api/session/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  res.json({ status: session.status, state: publicState(session), history: session.history });
});

function publicState(session) {
  return {
    company_name: session.variables.company_name,
    customer_name: session.variables.customer_name,
    agent_name: session.variables.agent_name,
    agent_gender: session.variables.agent_gender,
    language_to_speak: session.variables.language_to_speak,
    stage: session.stage,
    answers: session.answers,
    asked: session.asked,
    status: session.status,
    end_reason: session.endReason
  };
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Home Credit LAP Voice Agent demo running at http://localhost:${PORT}`);
  });
}

module.exports = app;
