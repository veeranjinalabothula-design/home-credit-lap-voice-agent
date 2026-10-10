let sessionId = null;

const setupPanel = document.getElementById("setupPanel");
const chatPanel = document.getElementById("chatPanel");
const messages = document.getElementById("messages");
const statusLine = document.getElementById("statusLine");
const stateView = document.getElementById("stateView");
const customerMessage = document.getElementById("customerMessage");
const sendButton = document.getElementById("sendButton");

document.getElementById("startForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer_name: document.getElementById("customerName").value,
      agent_name: document.getElementById("agentName").value,
      agent_gender: document.getElementById("agentGender").value,
      language_to_speak: document.getElementById("language").value
    })
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "Could not start the conversation.");
  sessionId = data.sessionId;
  messages.innerHTML = "";
  setupPanel.classList.add("hidden");
  chatPanel.classList.remove("hidden");
  addMessage("assistant", data.reply);
  renderState(data.state);
  customerMessage.focus();
});

document.getElementById("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sessionId) return;
  const text = customerMessage.value.trim();
  if (!text) return;
  addMessage("customer", text);
  customerMessage.value = "";
  sendButton.disabled = true;
  try {
    const response = await fetch(`/api/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_utterance: text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    addMessage("assistant", data.reply);
    renderState(data.state);
  } catch (error) {
    addMessage("assistant", `Sorry, there was a problem: ${error.message}`);
  } finally {
    sendButton.disabled = false;
    customerMessage.focus();
  }
});

document.getElementById("resetButton").addEventListener("click", () => {
  sessionId = null;
  chatPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
  messages.innerHTML = "";
  document.getElementById("customerName").focus();
});

function addMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;
  item.textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderState(state) {
  statusLine.textContent = `Status: ${state.status} · Stage: ${state.stage}`;
  stateView.textContent = JSON.stringify(state, null, 2);
  if (state.status !== "active") {
    customerMessage.disabled = true;
    sendButton.disabled = true;
    statusLine.textContent += " · Conversation ended";
  } else {
    customerMessage.disabled = false;
    sendButton.disabled = false;
  }
}
