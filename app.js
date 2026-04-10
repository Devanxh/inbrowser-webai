/**
 * app.js — Main Application Logic
 * Manages UI state, Worker communication, and conversation history.
 */

import { PROSPECTS } from "./prospects.js";

// ─── DOM References ───────────────────────────────────────────────────────────
const $loadingScreen = document.getElementById("loading-screen");
const $progressFill = document.getElementById("progress-fill");
const $progressLabel = document.getElementById("progress-label");
const $messages = document.getElementById("messages");
const $emptyState = document.getElementById("empty-state");
const $userInput = document.getElementById("user-input");
const $sendBtn = document.getElementById("send-btn");
const $stopBtn = document.getElementById("stop-btn");
const $systemPrompt = document.getElementById("system-prompt");
const $savePromptBtn = document.getElementById("save-prompt-btn");
const $clearBtn = document.getElementById("clear-btn");
const $prospectsRoot = document.getElementById("prospects-root");
const $modelStatus = document.getElementById("model-status-dot");
const $modelName = document.getElementById("model-name");
const $sidebarToggle = document.getElementById("sidebar-toggle");
const $sidebar = document.getElementById("sidebar");
const $chipBtns = document.querySelectorAll(".chip");

// ─── State ────────────────────────────────────────────────────────────────────
let worker = null;
let isGenerating = false;
let currentAiMsgEl = null;
let currentAiText = "";
let messageCount = 0;

const STORAGE_KEY_HISTORY = "lumina_chat_history";
const STORAGE_KEY_SYSTEM_PROMPT = "lumina_system_prompt";

const DEFAULT_SYSTEM_PROMPT = `You are Lumina, an eloquent and thoughtful AI assistant powered by the Qwen model running entirely in your browser. You are precise, helpful, and speak with clarity and warmth. You never reveal technical internals unless directly asked.`;

// ─── Conversation ─────────────────────────────────────────────────────────────
let conversationHistory = []; // [{role: "user"|"assistant", content: string}]

function getSystemPromptText() {
  return $systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT;
}

function buildMessages() {
  return [
    { role: "system", content: getSystemPromptText() },
    ...conversationHistory,
  ];
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(conversationHistory));
  } catch (e) { /* quota exceeded */ }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (raw) {
      conversationHistory = JSON.parse(raw);
      conversationHistory.forEach(({ role, content }) => appendMessage(role, content, true));
    }
  } catch (e) {
    conversationHistory = [];
  }
}

function loadSystemPrompt() {
  const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT);
  $systemPrompt.value = saved !== null ? saved : DEFAULT_SYSTEM_PROMPT;
}

// ─── Markdown-lite renderer ───────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // ### Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^\s*[-*•] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\s*\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs (double newline)
  html = html
    .split(/\n{2,}/)
    .map(block => {
      if (/^<(pre|ul|ol|h[1-3]|blockquote)/.test(block.trim())) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Message Rendering ────────────────────────────────────────────────────────
function appendMessage(role, content, restoring = false) {
  messageCount++;

  // Hide empty state
  $emptyState.classList.add("hidden");

  const isUser = role === "user";

  const msgEl = document.createElement("div");
  msgEl.className = `message ${isUser ? "user" : "ai"}`;
  msgEl.dataset.id = messageCount;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = isUser ? "✦" : "◆";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (isUser) {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  msgEl.appendChild(avatar);
  msgEl.appendChild(bubble);
  $messages.appendChild(msgEl);
  scrollToBottom();

  return { msgEl, bubble };
}

function appendTypingMessage() {
  $emptyState.classList.add("hidden");
  messageCount++;

  const msgEl = document.createElement("div");
  msgEl.className = "message ai";
  msgEl.dataset.id = messageCount;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "◆";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.className = "typing-dot";
    indicator.appendChild(dot);
  }

  bubble.appendChild(indicator);
  msgEl.appendChild(avatar);
  msgEl.appendChild(bubble);
  $messages.appendChild(msgEl);
  scrollToBottom();

  return { msgEl, bubble };
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    $messages.scrollTop = $messages.scrollHeight;
  });
}

// ─── Worker Communication ─────────────────────────────────────────────────────

// Download speed tracking
let _dlStart = null;
let _dlLastLoaded = 0;
let _dlLastTime = null;

function initWorker() {
  worker = new Worker("./worker.js", { type: "module" });

  worker.addEventListener("message", (event) => {
    const { type, data } = event.data;

    switch (type) {
      case "status": handleWorkerStatus(data); break;
      case "progress_raw": handleProgressRaw(data); break;
      case "progress_agg": handleProgressAgg(data); break;
      case "progress_file_done": handleFileDone(data); break;
      case "ready": onModelReady(data); break;
      case "token": onToken(data); break;
      case "done": onGenerationDone(data); break;
      case "aborted": onGenerationAborted(); break;
      case "error": onError(data); break;
    }
  });

  // Catch worker-level errors (syntax errors, import failures)
  worker.addEventListener("error", (e) => {
    onError(`Worker failed to start: ${JSON.stringify(e) || "unknown error"}. Check that WebGPU is enabled in your browser.`);
  });

  worker.postMessage({ type: "load" });
}

function handleWorkerStatus(status) {
  const labels = {
    loading_tokenizer: "Loading tokenizer…",
    loading_model: "Preparing model — download may take a moment on first run…",
    wasm_fallback: "WebGPU unavailable — switching to WASM (slower but works)…",
  };
  $progressLabel.textContent = labels[status] ?? status;
}

// Raw per-file progress (show which file is downloading)
function handleProgressRaw(info) {
  if (info.status === "initiate") {
    $progressLabel.textContent = `Fetching: ${shortName(info.file ?? info.name ?? "files")}…`;
  } else if (info.status === "done") {
    // individual file done — aggregated bar will handle overall pct
  }
}

// Aggregated bytes across all files → smooth overall bar
function handleProgressAgg({ loaded, total }) {
  if (!total) return;

  const pct = Math.min(100, Math.round((loaded / total) * 100));
  $progressFill.style.width = pct + "%";

  // Speed calculation
  const now = Date.now();
  if (!_dlStart) { _dlStart = now; _dlLastTime = now; _dlLastLoaded = loaded; }

  let speedStr = "";
  const elapsed = (now - _dlLastTime) / 1000;
  if (elapsed > 0.8) {
    const bytesPerSec = (loaded - _dlLastLoaded) / elapsed;
    _dlLastTime = now;
    _dlLastLoaded = loaded;
    if (bytesPerSec > 0) {
      const remaining = (total - loaded) / bytesPerSec;
      speedStr = ` · ${fmtSpeed(bytesPerSec)} · ~${fmtTime(remaining)} left`;
    }
  }

  const loadedMB = (loaded / 1024 / 1024).toFixed(1);
  const totalMB = (total / 1024 / 1024).toFixed(1);
  $progressLabel.textContent =
    `Downloading model… ${pct}%  (${loadedMB} / ${totalMB} MB)${speedStr}`;
}

function handleFileDone({ name }) {
  // Nothing extra needed; aggregated bar still updates
}

function shortName(path) {
  return path.split("/").pop().split("?")[0];
}

function fmtSpeed(bps) {
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function fmtTime(sec) {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function onModelReady(info) {
  $progressFill.style.width = "100%";
  $progressLabel.textContent = "Model ready!";

  // Brief pause so the user sees 100%  → then hide
  setTimeout(() => {
    $loadingScreen.classList.add("hidden");
  }, 600);

  const device = info?.device ?? "webgpu";
  $modelStatus.classList.add("ready");
  $modelName.textContent = `Qwen 2.5 0.5B · ${device.toUpperCase()}`;
  $sendBtn.disabled = false;
  $userInput.disabled = false;
  $userInput.focus();
}

function onToken(text) {
  if (!currentAiMsgEl) return;
  currentAiText += text;
  currentAiMsgEl.querySelector(".msg-bubble").innerHTML = renderMarkdown(currentAiText);
  scrollToBottom();
}

function onGenerationDone(fullText) {
  isGenerating = false;
  currentAiText = fullText; // ensure final text is set
  if (currentAiMsgEl) {
    currentAiMsgEl.querySelector(".msg-bubble").innerHTML = renderMarkdown(fullText);
  }
  // Persist to history
  conversationHistory.push({ role: "assistant", content: fullText });
  saveHistory();
  resetInputState();
}

function onGenerationAborted() {
  isGenerating = false;
  if (currentAiMsgEl && currentAiText) {
    conversationHistory.push({ role: "assistant", content: currentAiText });
    saveHistory();
  }
  resetInputState();
}

function onError(msg) {
  isGenerating = false;
  console.error("[Lumina Error]", msg);

  // Show error on loading screen
  if ($loadingScreen && !$loadingScreen.classList.contains("hidden")) {
    $progressFill.style.background = "var(--danger)";
    $progressFill.style.width = "100%";
    $progressLabel.style.color = "var(--danger)";
    $progressLabel.textContent = `⚠ Error: ${msg}`;

    // Show retry button
    const $retry = document.getElementById("retry-btn");
    if ($retry) $retry.style.display = "inline-flex";
    return;
  }

  // Append error inline in chat
  if (currentAiMsgEl) {
    currentAiMsgEl.querySelector(".msg-bubble").innerHTML =
      `<span style="color:var(--danger)">⚠ ${escapeHtml(msg)}</span>`;
  }
  resetInputState();
}

function resetInputState() {
  $sendBtn.disabled = false;
  $stopBtn.classList.remove("visible");
  $userInput.disabled = false;
  $userInput.focus();
  currentAiMsgEl = null;
  currentAiText = "";
}

// ─── Send Message ─────────────────────────────────────────────────────────────
async function sendMessage(text) {
  text = text.trim();
  if (!text || isGenerating) return;

  // Push and render user message
  conversationHistory.push({ role: "user", content: text });
  saveHistory();
  appendMessage("user", text);

  // Clear input
  $userInput.value = "";
  $userInput.style.height = "auto";

  // UI state
  isGenerating = true;
  $sendBtn.disabled = true;
  $userInput.disabled = true;
  $stopBtn.classList.add("visible");

  // Typing indicator → will be replaced on first token
  const { msgEl, bubble } = appendTypingMessage();
  currentAiMsgEl = msgEl;
  currentAiText = "";

  // First token replaces typing indicator
  const origOnToken = onToken.bind(this);
  worker.__firstToken = true;

  // Send to worker
  worker.postMessage({ type: "generate", data: { messages: buildMessages() } });
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────
$userInput.addEventListener("input", () => {
  $userInput.style.height = "auto";
  $userInput.style.height = Math.min($userInput.scrollHeight, 180) + "px";
});

$userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage($userInput.value);
  }
});

$sendBtn.addEventListener("click", () => sendMessage($userInput.value));

$stopBtn.addEventListener("click", () => {
  if (worker) worker.postMessage({ type: "abort" });
});

// ─── Save System Prompt ───────────────────────────────────────────────────────
$savePromptBtn.addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, $systemPrompt.value);
  $savePromptBtn.textContent = "Saved ✓";
  setTimeout(() => { $savePromptBtn.textContent = "Apply Persona"; }, 1500);
});

// ─── Clear History ────────────────────────────────────────────────────────────
$clearBtn.addEventListener("click", () => {
  conversationHistory = [];
  saveHistory();
  $messages.innerHTML = "";
  $emptyState.classList.remove("hidden");
  messageCount = 0;
});

// ─── Sidebar Toggle (mobile) ──────────────────────────────────────────────────
$sidebarToggle.addEventListener("click", () => {
  $sidebar.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if ($sidebar.classList.contains("open") &&
    !$sidebar.contains(e.target) &&
    e.target !== $sidebarToggle) {
    $sidebar.classList.remove("open");
  }
});

// ─── Example Chips ───────────────────────────────────────────────────────────
$chipBtns.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!isGenerating && !$sendBtn.disabled) {
      sendMessage(chip.dataset.prompt);
    }
  });
});

// ─── Render Prospects ─────────────────────────────────────────────────────────
function renderProspects() {
  if (!$prospectsRoot) return;

  PROSPECTS.forEach(({ phase, icon, items }) => {
    const block = document.createElement("div");

    const phaseEl = document.createElement("div");
    phaseEl.className = "prospect-phase";
    phaseEl.textContent = `${icon} ${phase}`;

    const itemsEl = document.createElement("div");
    itemsEl.className = "prospect-items";

    items.forEach(({ title, desc }) => {
      const item = document.createElement("div");
      item.className = "prospect-item";
      item.innerHTML = `
        <div class="prospect-item-title">${escapeHtml(title)}</div>
        <div class="prospect-item-desc">${escapeHtml(desc)}</div>
      `;
      itemsEl.appendChild(item);
    });

    block.appendChild(phaseEl);
    block.appendChild(itemsEl);
    $prospectsRoot.appendChild(block);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
function boot() {
  $sendBtn.disabled = true;
  $userInput.disabled = true;
  loadSystemPrompt();
  loadHistory();
  renderProspects();
  initWorker();
}

boot();
