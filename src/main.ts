import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// ── Config ──
let AI_CODER_URL = localStorage.getItem("ai-coder-url") || "http://134.199.195.14:30000";
let AI_VISION_URL = localStorage.getItem("ai-vision-url") || "http://134.199.195.14:8000";
let TELEGRAM_BOT_TOKEN = localStorage.getItem("telegram-bot-token") || "";
let TELEGRAM_CHAT_ID = localStorage.getItem("telegram-chat-id") || "";
let TELEGRAM_ENABLED = localStorage.getItem("telegram-enabled") === "true";
let telegramPollTimer: ReturnType<typeof setInterval> | null = null;
let telegramPollInFlight = false;
let telegramLastUpdateId = parseInt(localStorage.getItem("telegram-last-update-id") || "0", 10) || 0;
const DEFAULT_CODER_MODEL = "Qwen/Qwen3.6-27B";
const DEFAULT_VISION_MODEL = "Qwen/Qwen2-VL-7B-Instruct";
// Track server-detected models so getVisionModel/getCoderModel can use them as better fallbacks
let detectedCoderModel = "";
let detectedVisionModel = "";

export function getCoderModel(): string {
  const saved = localStorage.getItem("ai-coder-model");
  if (saved && !(detectedCoderModel && isBuiltInDefaultModel(saved, "coder"))) return saved;
  if (detectedCoderModel) return detectedCoderModel;
  return DEFAULT_CODER_MODEL;
}
export function getVisionUrl(): string {
  return AI_VISION_URL;
}
export function getVisionModel(): string {
  const saved = localStorage.getItem("ai-vision-model");
  if (saved && !(detectedVisionModel && isBuiltInDefaultModel(saved, "vision"))) return saved;
  if (detectedVisionModel) return detectedVisionModel;
  return DEFAULT_VISION_MODEL;
}

function isBuiltInDefaultModel(model: string, kind: "coder" | "vision"): boolean {
  return model === (kind === "coder" ? DEFAULT_CODER_MODEL : DEFAULT_VISION_MODEL);
}

// Shared exhaustive vision prompt — used by every screenshot → vision call so the
// coder always receives the full UI map: buttons, every visible word, every
// sentence, columns, rows, and labels with bounding-box coordinates.
const RICH_VISION_LOCATOR_PROMPT =
  "You are a UNIVERSAL UI COORDINATE + TEXT MAPPER. Return EXACTLY ONE valid JSON object — no markdown, no prose, no code fences.\n\n" +
  "Coordinates are integer pixels measured from the screenshot's top-left (0,0). Bounding boxes use {x, y, width, height} where (x, y) is the top-left corner. Center fields {x, y} are the click center.\n\n" +
  "Schema:\n" +
  "{\n" +
  "  \"program\": { \"name\": string|null, \"title\": string|null },\n" +
  "  \"screenshot\": { \"width\": number, \"height\": number },\n" +
  "  \"window\": { \"x\": number|null, \"y\": number|null, \"width\": number|null, \"height\": number|null, \"focused\": boolean|null },\n" +
  "  \"tools\": [ { \"name\": string, \"x\": number, \"y\": number, \"width\": number|null, \"height\": number|null, \"type\": string, \"enabled\": boolean, \"visible\": boolean } ],\n" +
  "  \"text_blocks\": [ { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"role\": string } ],\n" +
  "  \"sentences\":   [ { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number } ],\n" +
  "  \"words\":       [ { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number } ],\n" +
  "  \"columns\":     [ { \"name\": string|null, \"index\": number, \"x\": number, \"y\": number, \"width\": number, \"height\": number } ],\n" +
  "  \"rows\":        [ { \"index\": number, \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"cells\": [string] } ]\n" +
  "}\n\n" +
  "Be EXHAUSTIVE. Capture the entire program, not a sample:\n" +
  "- tools[]   — every interactive control (buttons, tabs, menu items, toolbar icons, ribbon buttons, checkboxes, radio buttons, dropdowns, sliders, inputs/textfields, links, scrollbars, titlebar buttons). Include the visible label or icon meaning.\n" +
  "- text_blocks[] — every static text region (headings, paragraphs, labels, status bars, tooltips, menu text, list items). role: heading|paragraph|label|caption|status|tooltip|menu_text|list_item.\n" +
  "- sentences[]   — split paragraphs into individual sentences with their own bounding boxes.\n" +
  "- words[]       — every visible word as its own entry with its own bbox. This is OCR-level granularity.\n" +
  "- columns[]/rows[] — for tables, lists, grids, spreadsheets, file explorers, mail clients: column headers and every row with its cell text.\n" +
  "- IMPORTANT: extract ONLY from the active target program window named in the user request; ignore other windows / background UI / desktop wallpaper.\n" +
  "- Do not describe actions, do not recommend solutions — emit raw coordinate/content values only.\n" +
  "- Caps: tools ≤ 250, text_blocks ≤ 200, sentences ≤ 200, words ≤ 600, columns ≤ 50, rows ≤ 200. If you must truncate, prioritize items in the active interaction area.\n" +
  "- Set arrays to [] when not applicable; set nullable scalars to null. Always return one valid JSON object.";

// ── Types ──
interface Skill {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  kind?: "chat" | "aiz-workflow";
  workflowId?: string;
}
interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
interface McpServerStatus {
  name: string;
  connected: boolean;
  tools: Array<{ name: string; description: string }>;
  error?: string;
}
interface AddMcpServerRequest { name: string; command: string; args: string[]; env: Record<string, string>; }
interface AizNode { id: string; type: string; x: number; y: number; config: Record<string, string>; }
interface CustomNodeConfigField { key: string; label: string; type: "text" | "textarea" | "select" | "number"; options?: string[]; placeholder?: string; }
interface CustomNodeType { id: string; name: string; icon: string; description: string; color: string; configFields: CustomNodeConfigField[]; executionCode: string; }
interface AizConnection { id: string; fromId: string; toId: string; }
interface RunningProgram { pid: number; name: string; title?: string; window_title?: string; }
interface InstalledApplication { name: string; }
export interface ScreenSize { width: number; height: number; }
export interface ScreenRegion { x: number; y: number; width: number; height: number; data?: string; }

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface AizWorkflowRecord {
  id: string;
  name: string;
  nodes: AizNode[];
  connections: AizConnection[];
  runMode: "once" | "loop" | "parallel" | "multiple";
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

type CustomNodeValidationResult = { ok: true; output: string } | { ok: false; error: string };

// ── State ──
let conversationHistory: ChatMessage[] = [];
let savedSkills: Skill[] = JSON.parse(localStorage.getItem("catog-skills") || "[]");
let isProcessing = false;
let currentAbortController: AbortController | null = null;
let chatStopRequested = false;
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let currentImportFile: File | null = null;
let aizNodes: AizNode[] = [];
let aizConnections: AizConnection[] = [];
let selectedNodeId: string | null = null;
let aizDragNode: AizNode | null = null;
let aizDragOffset = { x: 0, y: 0 };
let aizPendingConnection: { fromId: string; x: number; y: number } | null = null;
let aizOutputEl: HTMLDivElement | null = null;
let aizRunMode: "once" | "loop" | "parallel" | "multiple" = "once";
let aizRunCount = 3;
let aizIsRunning = false;
let aizStopRequested = false;
let aizLoopInterval: ReturnType<typeof setInterval> | null = null;
let aizDragType: string | null = null;
let customNodeTypes: CustomNodeType[] = JSON.parse(localStorage.getItem("catog-custom-node-types") || "[]");
const AIZ_WORKFLOWS_KEY = "catog-aiz-workflows";
let savedAizWorkflows: AizWorkflowRecord[] = JSON.parse(localStorage.getItem(AIZ_WORKFLOWS_KEY) || "[]");
let openAndLoadAizWorkflow: ((workflowId: string, autoRun?: boolean) => void) | null = null;
let aizPlayAllRunning = false;

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-EVOLVING ENGINE — Karpathy Auto-Research Pattern
// Records working steps, classifies tasks, injects proven context, and ratchets
// to keep only the best step sequences. Sends ≤2 sentences of UI context.
// ═══════════════════════════════════════════════════════════════════════════════

const EVOLVE_MEMORY_KEY = "catog-evolve-memory";
const EVOLVE_ENABLED_KEY = "catog-evolve-enabled";
const EVOLVE_MAX_CATEGORIES = 50;
const EVOLVE_MAX_SEQUENCES_PER_CAT = 5;
const EVOLVE_MAX_STEPS_PER_SEQ = 20;

interface EvolveStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  timestamp: number;
}

interface EvolveSequence {
  id: string;
  taskDescription: string;
  taskKeywords: string[];
  steps: EvolveStep[];
  successRate: number;
  totalRuns: number;
  lastUsed: number;
  createdAt: number;
}

interface EvolveMemoryStore {
  categories: Record<string, EvolveSequence[]>;
  totalStepsLearned: number;
  globalSuccessCount: number;
  globalTotalCount: number;
}

let evolveEnabled = localStorage.getItem(EVOLVE_ENABLED_KEY) !== "false";
let evolveMemory: EvolveMemoryStore = JSON.parse(
  localStorage.getItem(EVOLVE_MEMORY_KEY) || '{"categories":{},"totalStepsLearned":0,"globalSuccessCount":0,"globalTotalCount":0}'
);
let evolveCurrentSteps: EvolveStep[] = [];
let evolveCurrentTask = "";
let evolveCurrentCategory = "";
let evolveLastUISummary = "";

// Pending run waiting for human grade (Correct / Incorrect)
interface EvolvePendingRun {
  taskDescription: string;
  category: string;
  steps: EvolveStep[];
}
let evolvePendingRun: EvolvePendingRun | null = null;

// Heuristic: is this message asking the agent to drive the desktop (click,
// type, open apps, navigate UI), or is it just plain conversation? The vision
// snapshot path hides the Catog window mid-call, which is correct for
// automation tasks but jarring for chat. When in doubt, skip the snapshot.
const DESKTOP_AUTOMATION_VERBS = [
  "open", "launch", "start", "run", "execute",
  "click", "double-click", "right-click", "press", "tap",
  "type", "enter", "input", "fill", "paste",
  "navigate", "browse", "go to", "visit",
  "search", "find on", "look up",
  "close", "minimize", "maximize", "resize", "move window",
  "scroll", "drag", "drop",
  "screenshot", "capture screen",
  "save file", "open file", "create file", "delete file",
  "download", "upload",
  "switch to", "focus",
  "automate", "workflow", "task",
];
const DESKTOP_AUTOMATION_TARGETS = [
  "browser", "chrome", "firefox", "edge", "safari",
  "notepad", "word", "excel", "powerpoint", "outlook",
  "explorer", "file explorer", "finder",
  "terminal", "cmd", "powershell", "bash",
  "calculator", "settings", "control panel",
  "vscode", "code editor",
  "window", "tab", "menu", "button", "address bar",
  "desktop", "taskbar", "start menu",
];
function looksLikeDesktopAutomationTask(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();
  if (msg.length < 4) return false;
  if (DESKTOP_AUTOMATION_VERBS.some((v) => msg.includes(v))) return true;
  if (DESKTOP_AUTOMATION_TARGETS.some((t) => msg.includes(t))) return true;
  return false;
}

// ── Task Classifier ──
// Extracts normalized keywords from user request to create a task category.
function evolveClassifyTask(userMessage: string): { category: string; keywords: string[] } {
  const msg = userMessage.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const stopwords = new Set(["the", "a", "an", "is", "to", "in", "on", "for", "and", "or", "it", "of", "at", "do", "my", "me", "this", "that", "i", "can", "you", "please", "would", "could", "should", "will", "just"]);
  const words = msg.split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));

  // Action-object pairing for category
  const actionWords = ["open", "close", "click", "type", "navigate", "search", "download", "upload", "create", "delete", "move", "resize", "copy", "paste", "save", "launch", "run", "install", "write", "read", "send", "check", "find", "browse", "scroll", "drag", "maximize", "minimize"];
  const objectWords = ["browser", "chrome", "safari", "firefox", "file", "folder", "document", "notepad", "terminal", "calculator", "settings", "desktop", "window", "tab", "page", "website", "url", "email", "message", "image", "video", "text", "code", "app", "application", "program", "menu", "button", "link", "form", "input"];

  const actions = words.filter(w => actionWords.some(a => w.includes(a)));
  const objects = words.filter(w => objectWords.some(o => w.includes(o)));

  // Build category from most distinctive action+object combo
  const categoryParts: string[] = [];
  if (actions.length > 0) categoryParts.push(actions[0]);
  if (objects.length > 0) categoryParts.push(objects[0]);
  if (categoryParts.length === 0) {
    // Fallback: use first 2 meaningful words
    categoryParts.push(...words.slice(0, 2));
  }

  const category = categoryParts.join("_") || "general";
  return { category, keywords: words.slice(0, 6) };
}

// ── Memory Persistence ──
function evolveSaveMemory(): void {
  localStorage.setItem(EVOLVE_MEMORY_KEY, JSON.stringify(evolveMemory));
}

function evolveClearMemory(): void {
  evolveMemory = { categories: {}, totalStepsLearned: 0, globalSuccessCount: 0, globalTotalCount: 0 };
  evolveSaveMemory();
  evolveUpdateUI();
}

// ── Step Recording ──
function evolveRecordStep(tool: string, args: Record<string, unknown>, result: string, success: boolean): void {
  if (!evolveEnabled || !evolveCurrentTask) return;
  const step: EvolveStep = {
    tool,
    args: sanitizeArgsForMemory(args),
    result: result.substring(0, 200),
    success,
    timestamp: Date.now(),
  };
  evolveCurrentSteps.push(step);

  // Update global counters
  evolveMemory.globalTotalCount++;
  if (success) evolveMemory.globalSuccessCount++;

  evolveSetStatus("recording", `Recording step: ${tool}`);
}

// Remove large binary data / secrets from args before storing
function sanitizeArgsForMemory(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (key === "_targetApp") continue;
    if (typeof val === "string" && val.length > 500) {
      sanitized[key] = val.substring(0, 100) + "…[truncated]";
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

// ── Stage a run for human grading ──
// After a task completes we no longer auto-commit. We stash the run and reveal
// the Correct / Incorrect buttons in the Self-Evolving panel. The human grade
// is the source of truth for whether a sequence enters memory.
function evolveStageRunForGrading(taskDescription: string, category: string): void {
  if (!evolveEnabled || evolveCurrentSteps.length === 0) {
    evolveCurrentSteps = [];
    evolveSetGradeUI(null);
    return;
  }

  evolvePendingRun = {
    taskDescription: taskDescription.substring(0, 200),
    category,
    steps: evolveCurrentSteps.slice(0, EVOLVE_MAX_STEPS_PER_SEQ),
  };
  evolveCurrentSteps = [];
  evolveSetGradeUI(evolvePendingRun);
  evolveRatchetLog("neutral", `Awaiting grade for "${category}" (${evolvePendingRun.steps.length} steps).`);
}

// User clicked Correct or Incorrect on the staged run.
function evolveApplyHumanGrade(correct: boolean): void {
  if (!evolvePendingRun) return;
  const { taskDescription, category, steps } = evolvePendingRun;

  if (!correct) {
    evolveRatchetLog("revert", `❌ User marked incorrect — discarded "${category}" (${steps.length} steps).`);
    evolvePendingRun = null;
    evolveSetGradeUI(null);
    evolveSaveMemory();
    evolveUpdateUI();
    return;
  }

  // Correct: commit the sequence with a perfect human-graded success rate.
  // Human grade overrides the per-step tool-call success heuristic.
  const newSequence: EvolveSequence = {
    id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    taskDescription,
    taskKeywords: evolveClassifyTask(taskDescription).keywords,
    steps,
    successRate: 1,
    totalRuns: 1,
    lastUsed: Date.now(),
    createdAt: Date.now(),
  };

  if (!evolveMemory.categories[category]) {
    evolveMemory.categories[category] = [];
  }
  const existing = evolveMemory.categories[category];
  existing.push(newSequence);
  evolveMemory.totalStepsLearned += steps.length;

  // Prune: keep only top N sequences per category, prefer human-graded (rate 1) and recent.
  if (existing.length > EVOLVE_MAX_SEQUENCES_PER_CAT) {
    existing.sort((a, b) => b.successRate - a.successRate || b.lastUsed - a.lastUsed);
    existing.splice(EVOLVE_MAX_SEQUENCES_PER_CAT);
  }

  // Prune categories
  const categoryKeys = Object.keys(evolveMemory.categories);
  if (categoryKeys.length > EVOLVE_MAX_CATEGORIES) {
    const sorted = categoryKeys.map(k => ({
      key: k,
      lastUsed: Math.max(...evolveMemory.categories[k].map(s => s.lastUsed)),
    })).sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < sorted.length - EVOLVE_MAX_CATEGORIES; i++) {
      delete evolveMemory.categories[sorted[i].key];
    }
  }

  evolveRatchetLog("commit", `✅ User graded correct — committed ${steps.length} steps for "${category}".`);
  evolvePendingRun = null;
  evolveSetGradeUI(null);
  evolveSaveMemory();
  evolveUpdateUI();
}

// Show / hide the Grade Last Run panel.
function evolveSetGradeUI(pending: EvolvePendingRun | null): void {
  const grade = document.getElementById("evolve-grade") as HTMLElement | null;
  const taskEl = document.getElementById("evolve-grade-task");
  if (!grade) return;
  if (!pending) {
    grade.hidden = true;
    if (taskEl) taskEl.textContent = "";
    return;
  }
  grade.hidden = false;
  if (taskEl) {
    const preview = pending.taskDescription.length > 80
      ? pending.taskDescription.substring(0, 80) + "…"
      : pending.taskDescription;
    taskEl.textContent = `“${preview}” — ${pending.steps.length} steps`;
  }
}

// ── Retrieve Best Steps for Task ──
// Returns the best matching proven step sequence for a given task, limited to
// a compact 2-sentence description for the AI context.
function evolveGetProvenContext(userMessage: string): string | null {
  if (!evolveEnabled) return null;

  const { category, keywords } = evolveClassifyTask(userMessage);
  evolveCurrentCategory = category;

  // Direct category match
  let sequences = evolveMemory.categories[category];

  // Fuzzy match: search across all categories for keyword overlap
  if (!sequences || sequences.length === 0) {
    let bestMatch: { cat: string; score: number; seqs: EvolveSequence[] } | null = null;
    for (const [cat, seqs] of Object.entries(evolveMemory.categories)) {
      const catKeywords = seqs.flatMap(s => s.taskKeywords);
      const overlap = keywords.filter(k => catKeywords.some(ck => ck.includes(k) || k.includes(ck))).length;
      if (overlap > 0 && (!bestMatch || overlap > bestMatch.score)) {
        bestMatch = { cat, score: overlap, seqs };
      }
    }
    if (bestMatch && bestMatch.score >= 2) {
      sequences = bestMatch.seqs;
      evolveCurrentCategory = bestMatch.cat;
    }
  }

  if (!sequences || sequences.length === 0) return null;

  // Pick the best sequence
  const best = sequences.reduce((a, b) => a.successRate > b.successRate ? a : b);
  best.lastUsed = Date.now();
  best.totalRuns++;
  evolveSaveMemory();

  // Build compact context (limited to task-specific steps)
  const stepSummary = best.steps
    .slice(0, 8)
    .map((s, i) => `${i + 1}. ${s.tool}(${Object.keys(s.args).join(",")})`)
    .join(" → ");

  return `[Evolved Memory] For a similar task ("${best.taskDescription.substring(0, 80)}"), proven steps are: ${stepSummary}. This sequence had ${(best.successRate * 100).toFixed(0)}% success rate across ${best.totalRuns} run(s).`;
}

// ── 2-Sentence UI Summarizer ──
// Captures a screenshot and generates exactly 2 sentences describing the current
// computer interface, keeping context lightweight for the AI agent.
async function evolveGet2SentenceUISummary(): Promise<string> {
  if (!evolveEnabled) return "";
  try {
    const screenshot = await captureScreen();
    if (!screenshot) return "";

    const summary = await streamVisionChat([
      {
        role: "system",
        content: "You are a concise UI describer. Describe the current computer screen in EXACTLY 2 sentences. Sentence 1: what program/window is active and its state. Sentence 2: what the user can interact with right now. No JSON, no markdown, just 2 plain sentences."
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
          { type: "text", text: "Describe this screen in exactly 2 sentences." },
        ],
      },
    ]);

    // Strip any thinking tags and enforce 2-sentence limit
    let cleaned = stripThinking(summary).trim();
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
    cleaned = sentences.slice(0, 2).join(" ").trim();

    evolveLastUISummary = cleaned;
    evolveUpdateUISummaryDisplay(cleaned);
    return cleaned;
  } catch {
    return "";
  }
}

// ── UI Dashboard ──
function evolveSetStatus(state: "idle" | "learning" | "active" | "recording", text: string): void {
  const indicator = document.getElementById("evolve-indicator");
  const statusText = document.getElementById("evolve-status-text");
  if (indicator) {
    indicator.className = `evolve-indicator ${state}`;
  }
  if (statusText) {
    statusText.textContent = text;
  }
}

function evolveUpdateUI(): void {
  const memCountEl = document.getElementById("evolve-memory-count");
  const successRateEl = document.getElementById("evolve-success-rate");
  const stepsLearnedEl = document.getElementById("evolve-steps-learned");

  const totalSequences = Object.values(evolveMemory.categories).reduce((sum, seqs) => sum + seqs.length, 0);

  if (memCountEl) memCountEl.textContent = `${totalSequences}`;
  if (stepsLearnedEl) stepsLearnedEl.textContent = `${evolveMemory.totalStepsLearned}`;
  if (successRateEl) {
    if (evolveMemory.globalTotalCount > 0) {
      const rate = (evolveMemory.globalSuccessCount / evolveMemory.globalTotalCount * 100).toFixed(0);
      successRateEl.textContent = `${rate}%`;
    } else {
      successRateEl.textContent = "—";
    }
  }
}

function evolveUpdateUISummaryDisplay(text: string): void {
  const el = document.getElementById("evolve-ui-text");
  if (el) el.textContent = text || "No UI snapshot yet.";
}

function evolveRatchetLog(type: "commit" | "revert" | "neutral", message: string): void {
  const logEl = document.getElementById("evolve-ratchet-log");
  if (!logEl) return;
  const entry = document.createElement("div");
  entry.className = `ratchet-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;

  // Keep only last 20 entries
  while (logEl.children.length > 20) {
    logEl.removeChild(logEl.children[0]);
  }
}

function evolveToggleEnabled(): void {
  evolveEnabled = !evolveEnabled;
  localStorage.setItem(EVOLVE_ENABLED_KEY, String(evolveEnabled));
  const iconEl = document.getElementById("evolve-toggle-icon");
  const labelEl = document.getElementById("evolve-toggle-label");
  if (iconEl) iconEl.textContent = evolveEnabled ? "⏸" : "▶";
  if (labelEl) labelEl.textContent = evolveEnabled ? "Enabled" : "Disabled";
  evolveSetStatus("idle", evolveEnabled ? "Idle — waiting for task" : "Disabled");
}

// ── Begin/End Task Lifecycle (called from processUserMessage) ──
function evolveBeginTask(userMessage: string): void {
  if (!evolveEnabled) return;
  evolveCurrentTask = userMessage;
  evolveCurrentSteps = [];
  const { category } = evolveClassifyTask(userMessage);
  evolveCurrentCategory = category;
  evolveSetStatus("learning", `Analyzing: ${category}`);
  evolveRatchetLog("neutral", `Task started: "${userMessage.substring(0, 60)}…" → category: ${category}`);
}

function evolveEndTask(): void {
  if (!evolveEnabled || !evolveCurrentTask) return;
  evolveStageRunForGrading(evolveCurrentTask, evolveCurrentCategory);
  evolveSetStatus("idle", "Awaiting your grade — Correct or Incorrect?");
  evolveCurrentTask = "";
  evolveCurrentCategory = "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLORE TOOL — Self Learning
// Walks a target program and records every button, menu, tab, dialog with its
// purpose. Saves a "program profile" keyed by program name. When a workflow
// later targets the same program, the profile is injected as extra context so
// the coder model already knows the layout.
// ═══════════════════════════════════════════════════════════════════════════════

const PROGRAM_PROFILES_KEY = "catog-program-profiles";

interface ProgramTool {
  name: string;
  type: string;            // button | tab | menu_item | input | toolbar_icon | …
  purpose: string;         // one-line description of what this control does
  location: string;        // textual hint where to find it ("File menu → Save As")
  shortcut?: string;       // keyboard shortcut if discovered
}

interface ProgramProfile {
  programName: string;     // canonical name as the user typed it
  programTitle?: string;   // window title detected during exploration
  tools: ProgramTool[];
  iterations: number;
  createdAt: number;
  updatedAt: number;
}

interface ProgramProfileStore {
  profiles: Record<string, ProgramProfile>; // key: lowercased program name
}

function exploreLoadProfiles(): ProgramProfileStore {
  try {
    const raw = localStorage.getItem(PROGRAM_PROFILES_KEY);
    if (!raw) return { profiles: {} };
    const parsed = JSON.parse(raw) as ProgramProfileStore;
    if (!parsed || typeof parsed !== "object" || !parsed.profiles) return { profiles: {} };
    return parsed;
  } catch {
    return { profiles: {} };
  }
}

function exploreSaveProfiles(store: ProgramProfileStore): void {
  localStorage.setItem(PROGRAM_PROFILES_KEY, JSON.stringify(store));
}

function exploreGetProfile(programName: string): ProgramProfile | null {
  const key = programName.trim().toLowerCase();
  if (!key) return null;
  const store = exploreLoadProfiles();
  return store.profiles[key] || null;
}

function exploreUpsertProfile(profile: ProgramProfile): void {
  const store = exploreLoadProfiles();
  const key = profile.programName.trim().toLowerCase();
  const existing = store.profiles[key];
  if (existing) {
    // Merge: dedupe by lowercase name, keep richer purpose strings.
    const byName = new Map<string, ProgramTool>();
    for (const t of existing.tools) byName.set(t.name.trim().toLowerCase(), t);
    for (const t of profile.tools) {
      const k = t.name.trim().toLowerCase();
      const prev = byName.get(k);
      if (!prev) {
        byName.set(k, t);
      } else {
        byName.set(k, {
          name: t.name || prev.name,
          type: t.type || prev.type,
          purpose: t.purpose.length > prev.purpose.length ? t.purpose : prev.purpose,
          location: t.location || prev.location,
          shortcut: t.shortcut || prev.shortcut,
        });
      }
    }
    profile = {
      ...profile,
      tools: Array.from(byName.values()),
      iterations: existing.iterations + profile.iterations,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
  }
  store.profiles[key] = profile;
  exploreSaveProfiles(store);
}

function exploreDeleteProfile(programName: string): void {
  const store = exploreLoadProfiles();
  delete store.profiles[programName.trim().toLowerCase()];
  exploreSaveProfiles(store);
}

// Returns formatted context to inject into a coder prompt for a given program.
function exploreGetProfileContext(programName: string): string | null {
  const p = exploreGetProfile(programName);
  if (!p || p.tools.length === 0) return null;
  const lines = p.tools.slice(0, 60).map((t) => {
    const sc = t.shortcut ? ` [${t.shortcut}]` : "";
    const loc = t.location ? ` (${t.location})` : "";
    return `- ${t.name}${sc}: ${t.purpose}${loc}`;
  });
  return `[Self-Learning Profile: ${p.programName}]\nKnown controls and what they do:\n${lines.join("\n")}`;
}

// ── Exploration runner ──
let exploreRunning = false;
let exploreStopFlag = false;

interface ExploreOpts {
  programName: string;
  iterations: number;
  onLog: (msg: string, kind?: "info" | "tool" | "iter" | "warn" | "done") => void;
  onStat: (toolsCount: number, iter: number) => void;
}

async function runProgramExploration(opts: ExploreOpts): Promise<ProgramProfile> {
  const { programName, iterations, onLog, onStat } = opts;
  const discovered: ProgramTool[] = [];
  let detectedTitle = "";

  exploreRunning = true;
  exploreStopFlag = false;
  onLog(`Launching "${programName}"…`, "info");

  // 1. Make sure the program is running and focused.
  try {
    await invoke("launch_application", { name: programName });
    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) {
    onLog(`launch_application failed: ${String(e)} — continuing anyway in case it's already open.`, "warn");
  }

  // 2. Drive the vision+coder loop with an exploration task.
  const task =
    `EXPLORATION MODE: You are mapping the program "${programName}" so future automations can use it.\n` +
    `For each iteration:\n` +
    `  1. Look at the current screen (the vision map gives you tools/text/words/coordinates).\n` +
    `  2. Pick ONE menu, tab, ribbon, or panel that you have not opened yet and click it (use long_press_at for nested menus, or press_key_combo for shortcuts like alt+f, alt+e, etc.).\n` +
    `  3. After it opens, the next iteration will record what's inside.\n` +
    `Strategy: open every File / Edit / View / Insert / Format / Tools / Help-style menu, and every tab on a ribbon. Then close any modal so other menus stay reachable.\n` +
    `IMPORTANT: do NOT close the program. Do NOT type random text. Just navigate.\n` +
    `When you have visited all top-level menus and tabs, output exactly: TASK_DONE: exploration complete.`;

  let iterCount = 0;

  // Patch onLog to also drive the live tool counter as we accumulate from the
  // vision map written by the agent loop. We extract tool entries from each
  // streaming log line that looks like a JSON snippet.
  const wrappedLog = (msg: string, _color?: string) => {
    if (exploreStopFlag) return;
    const lower = msg.toLowerCase();
    if (lower.startsWith("iteration ") || lower.startsWith("vision iteration") || lower.startsWith("step ")) {
      iterCount++;
      onStat(discovered.length, iterCount);
      onLog(msg, "iter");
    } else if (lower.includes("tool_call") || lower.includes("click_at") || lower.includes("press_key") || lower.includes("type_text")) {
      onLog(msg, "tool");
    } else {
      onLog(msg);
    }
  };

  try {
    await runVisionGuidedAgent({
      task,
      appContext: programName,
      maxIterations: Math.max(5, Math.min(iterations, 60)),
      log: wrappedLog,
      isStopped: () => exploreStopFlag,
    });
  } catch (e) {
    onLog(`Vision agent error: ${String(e)}`, "warn");
  }

  // 3. After the navigation loop, take one final screenshot per top-level menu
  //    and ask the vision model to enumerate every control with its function.
  //    We do this here once at the end so we can ask explicitly for purposes,
  //    not just coordinates.
  if (!exploreStopFlag) {
    onLog("Summarizing discovered controls — asking vision model for tool descriptions…", "info");
    try {
      const screenshot = await captureScreen();
      if (screenshot) {
        const summarySystem =
          "You are a software-tools cataloguer. From the screenshot, list every visible interactive control (button, menu item, tab, ribbon icon, toolbar icon, input, checkbox, dropdown). " +
          "For each, infer its FUNCTION based on its label, icon, and surrounding context — not just its name. Return EXACTLY ONE JSON object, no markdown:\n" +
          "{ \"program_title\": string, \"tools\": [ { \"name\": string, \"type\": string, \"purpose\": string, \"location\": string, \"shortcut\": string|null } ] }\n" +
          "Rules: name = visible label or icon meaning; type = button|menu_item|tab|toolbar_icon|input|checkbox|dropdown|other; purpose = one short sentence saying what clicking/using it does; location = where in the UI to find it (e.g. 'Home tab', 'File menu'); shortcut = visible accelerator like 'Ctrl+S' or null.";
        const summary = await streamVisionChat([
          { role: "system", content: summarySystem },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
              { type: "text", text: `The program is "${programName}". Catalogue every visible control with its function.` },
            ],
          },
        ]);
        try {
          const parsed = extractJsonFromResponse(summary);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.program_title === "string") detectedTitle = parsed.program_title.trim();
            const toolsArr = Array.isArray(parsed.tools) ? parsed.tools : [];
            for (const t of toolsArr) {
              if (!t || typeof t !== "object") continue;
              const name = typeof (t as any).name === "string" ? (t as any).name.trim() : "";
              if (!name) continue;
              discovered.push({
                name,
                type: typeof (t as any).type === "string" ? (t as any).type : "control",
                purpose: typeof (t as any).purpose === "string" ? (t as any).purpose : "",
                location: typeof (t as any).location === "string" ? (t as any).location : "",
                shortcut: typeof (t as any).shortcut === "string" && (t as any).shortcut ? (t as any).shortcut : undefined,
              });
            }
            onLog(`Catalogued ${toolsArr.length} controls from final screen.`, "tool");
          }
        } catch (parseErr) {
          onLog(`Could not parse cataloguer JSON: ${String(parseErr)}`, "warn");
        }
      }
    } catch (e) {
      onLog(`Cataloguer pass failed: ${String(e)}`, "warn");
    }
  }

  exploreRunning = false;
  onStat(discovered.length, iterCount);

  const profile: ProgramProfile = {
    programName: programName.trim(),
    programTitle: detectedTitle || undefined,
    tools: discovered,
    iterations: iterCount,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (discovered.length > 0) {
    exploreUpsertProfile(profile);
    onLog(`Saved profile for "${profile.programName}" with ${profile.tools.length} controls.`, "done");
  } else {
    onLog(`No controls were catalogued — profile not saved.`, "warn");
  }

  return profile;
}

// ── Workflow Execution Context (Isolation) ──
interface WorkflowExecutionContext {
  id: string;
  workflowId: string;
  nodes: AizNode[];
  connections: AizConnection[];
  stopSignal: { stop: boolean };
  isRunning: boolean;
  loopInterval: ReturnType<typeof setInterval> | null;
}

// Active workflow execution contexts (for isolation)
const activeWorkflowContexts = new Map<string, WorkflowExecutionContext>();

function createWorkflowContext(workflowId: string, nodes: AizNode[], connections: AizConnection[]): WorkflowExecutionContext {
  const contextId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const context: WorkflowExecutionContext = {
    id: contextId,
    workflowId,
    nodes: cloneAizNodes(nodes),
    connections: cloneAizConnections(connections),
    stopSignal: { stop: false },
    isRunning: false,
    loopInterval: null,
  };
  activeWorkflowContexts.set(contextId, context);
  return context;
}

function destroyWorkflowContext(contextId: string): void {
  const context = activeWorkflowContexts.get(contextId);
  if (context) {
    if (context.loopInterval) {
      clearInterval(context.loopInterval);
    }
    context.stopSignal.stop = true;
    activeWorkflowContexts.delete(contextId);
  }
}

function stopAllWorkflowContexts(): void {
  for (const [_contextId, context] of activeWorkflowContexts.entries()) {
    context.stopSignal.stop = true;
    if (context.loopInterval) {
      clearInterval(context.loopInterval);
      context.loopInterval = null;
    }
  }
  activeWorkflowContexts.clear();
}

// ── Session State ──
const SESSIONS_KEY = "catog-sessions";
const ACTIVE_SESSION_KEY = "catog-active-session-id";
let allSessions: ChatSession[] = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
let activeSessionId: string = localStorage.getItem(ACTIVE_SESSION_KEY) || "";

function generateSessionId(): string { return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function createSession(title?: string): ChatSession {
  const sess: ChatSession = {
    id: generateSessionId(),
    title: title || `Session ${allSessions.length + 1}`,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  allSessions.unshift(sess);
  saveSessions();
  return sess;
}

function saveSessions(): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));
}

function getActiveSession(): ChatSession | undefined {
  return allSessions.find(s => s.id === activeSessionId);
}

function autosaveCurrentSession(): void {
  const sess = getActiveSession();
  if (!sess) return;
  saveSessionById(sess.id, conversationHistory);
}

function saveSessionById(sessionId: string, messages: ChatMessage[]): void {
  const sess = allSessions.find((s) => s.id === sessionId);
  if (!sess) return;
  sess.messages = [...messages];
  sess.updatedAt = new Date().toISOString();
  // Auto-title from first user message if still default
  if (sess.title.startsWith("Session ") && messages.length > 0) {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) {
      sess.title = firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? "…" : "");
    }
  }
  saveSessions();
}

function loadSession(sess: ChatSession): void {
  activeSessionId = sess.id;
  localStorage.setItem(ACTIVE_SESSION_KEY, sess.id);
  conversationHistory = [...sess.messages];
  // Re-render chat from history
  chatLogEl.innerHTML = "";
  for (const msg of sess.messages) {
    if (msg.role === "system") continue; // skip system prompts
    appendMessage(msg.role as "user" | "assistant", msg.content);
  }
  renderSessions();
}

function deleteSession(sessId: string): void {
  allSessions = allSessions.filter(s => s.id !== sessId);
  saveSessions();
  if (activeSessionId === sessId) {
    if (allSessions.length > 0) {
      loadSession(allSessions[0]);
    } else {
      const fresh = createSession();
      loadSession(fresh);
    }
  } else {
    renderSessions();
  }
}

// ── DOM ──
const chatLogEl = document.querySelector("#chat-log") as HTMLDivElement;
const sessionListEl = document.querySelector("#session-list") as HTMLUListElement;
const chatFormEl = document.querySelector("#chat-form") as HTMLFormElement;
const chatInputEl = document.querySelector("#chat-input") as HTMLInputElement;
const chatSendBtn = document.querySelector("#chat-send-btn") as HTMLButtonElement;
const menuToggleEl = document.querySelector("#menu-toggle") as HTMLButtonElement;
const appShellEl = document.querySelector(".app-shell") as HTMLElement;
const btnMcp = document.querySelector("#btn-mcp") as HTMLButtonElement;
const btnAi = document.querySelector("#btn-ai") as HTMLButtonElement;

const tabSelfEvolving = document.querySelector("#tab-self-evolving") as HTMLButtonElement;
const tabIntegrations = document.querySelector("#tab-integrations") as HTMLButtonElement;
const contentSelfEvolving = document.querySelector("#content-self-evolving") as HTMLDivElement;
const contentIntegrations = document.querySelector("#content-integrations") as HTMLDivElement;

if (tabSelfEvolving && tabIntegrations && contentSelfEvolving && contentIntegrations) {
  tabSelfEvolving.addEventListener("click", () => {
    tabSelfEvolving.classList.add("active");
    tabIntegrations.classList.remove("active");
    contentSelfEvolving.classList.remove("hidden");
    contentIntegrations.classList.add("hidden");
  });
  tabIntegrations.addEventListener("click", () => {
    tabIntegrations.classList.add("active");
    tabSelfEvolving.classList.remove("active");
    contentIntegrations.classList.remove("hidden");
    contentSelfEvolving.classList.add("hidden");
  });
}
const mcpWidget = document.querySelector("#mcp-widget") as HTMLDivElement;
const aiWidget = document.querySelector("#ai-widget") as HTMLDivElement;
const closeMcp = document.querySelector("#close-mcp") as HTMLButtonElement;
const closeAi = document.querySelector("#close-ai") as HTMLButtonElement;
const btnTelegram = document.querySelector("#btn-telegram") as HTMLButtonElement;
const telegramWidget = document.querySelector("#telegram-widget") as HTMLDivElement;
const closeTelegram = document.querySelector("#close-telegram") as HTMLButtonElement;
const saveTelegram = document.querySelector("#save-telegram") as HTMLButtonElement;
const telegramToast = document.querySelector("#telegram-toast") as HTMLDivElement;
const telegramStatus = document.querySelector("#telegram-status") as HTMLDivElement;
const saveMcp = document.querySelector("#save-mcp") as HTMLButtonElement;
const saveAi = document.querySelector("#save-ai") as HTMLButtonElement;
const btnImportSkill = document.querySelector("#btn-import-skill") as HTMLButtonElement;
const btnExportSkill = document.querySelector("#btn-export-skill") as HTMLButtonElement;
const importSkillWidget = document.querySelector("#import-skill-widget") as HTMLDivElement;
const exportSkillWidget = document.querySelector("#export-skill-widget") as HTMLDivElement;
const closeImportSkill = document.querySelector("#close-import-skill") as HTMLButtonElement;
const closeExportSkill = document.querySelector("#close-export-skill") as HTMLButtonElement;
const saveImportSkill = document.querySelector("#save-import-skill") as HTMLButtonElement;
const saveExportSkill = document.querySelector("#save-export-skill") as HTMLButtonElement;
const importDropZone = document.querySelector("#import-drop-zone") as HTMLDivElement;
const importSkillFile = document.querySelector("#import-skill-file") as HTMLInputElement;
const importFilePreview = document.querySelector("#import-file-preview") as HTMLDivElement;
const importPreviewName = document.querySelector("#import-preview-name") as HTMLSpanElement;
const importPreviewSize = document.querySelector("#import-preview-size") as HTMLSpanElement;
const importFormatBadge = document.querySelector("#import-format-badge") as HTMLSpanElement;
const importPreviewRemove = document.querySelector("#import-preview-remove") as HTMLButtonElement;
const importSkillName = document.querySelector("#import-skill-name") as HTMLInputElement;
const importToast = document.querySelector("#import-toast") as HTMLDivElement;
const exportSkillSelect = document.querySelector("#export-skill-select") as HTMLSelectElement;

const exportPreview = document.querySelector("#export-preview") as HTMLDivElement;
const exportPreviewCode = document.querySelector("#export-preview-code") as HTMLPreElement;
const exportPreviewCopy = document.querySelector("#export-preview-copy") as HTMLButtonElement;
const exportToast = document.querySelector("#export-toast") as HTMLDivElement;
const closeTerminal = document.querySelector("#close-terminal") as HTMLButtonElement;
const terminalContainer = document.querySelector("#terminal-container") as HTMLDivElement;
const skillsListEl = document.querySelector("#skills-list") as HTMLDivElement;
const mcpJsonInput = document.querySelector("#mcp-json") as HTMLTextAreaElement;
const mcpToast = document.querySelector("#mcp-toast") as HTMLDivElement;
const btnAizSkill = document.querySelector("#btn-aiz-skill") as HTMLButtonElement;
const aizSkillWidget = document.querySelector("#aiz-skill-widget") as HTMLDivElement;
const aizSkillBackdrop = document.querySelector("#aiz-skill-backdrop") as HTMLDivElement;
const closeAizSkill = document.querySelector("#close-aiz-skill") as HTMLButtonElement;

// ── System Prompt ──
const SYSTEM_PROMPT = `You are CATOG, an AI desktop automation agent running on the user's computer.
You have access to a built-in terminal and native OS desktop automation tools.

**Terminal:**
- Use the embedded terminal for any command execution (bash, powershell, etc.)
- The terminal is fully functional and interactive

**Tool Calls:**
When you need to perform a desktop action, output a tool call in this exact format:
\`\`\`tool_call
{"tool": "tool_name", "arguments": {"key": "value"}}
\`\`\`

Or use the short array format:
["tool_name", {"key": "value"}]

Available tools:
- **click_at** (x, y) — Click at screen coordinates
- **long_press_at** (x, y, duration_ms) — Long press (hold click) at coordinates for duration in ms
- **scroll_at** (x, y, direction, amount) — Scroll at coordinates. direction: "up"/"down"/"left"/"right", amount: number of ticks
- **drag** (from_x, from_y, to_x, to_y, duration_ms) — Drag from one point to another
- **type_text** (text) — Type text string at current cursor position
- **press_key_combo** (keys) — Press key combination, e.g. "command+c", "ctrl+shift+s"
- **screenshot** (x, y, width, height) — Capture screen region as base64 PNG. Use {} for full screen.
- **get_screen_size** () — Get screen dimensions {width, height}
- **launch_application** (name) — Launch an application by name, e.g. "Google Chrome", "Safari", "Firefox", "Calculator"
- **get_running_programs** () — List currently running programs with window titles
- **get_installed_applications** () — List installed applications on the system
- **get_active_window_bounds** () — Get front window position and size {x, y, width, height}
- **get_active_window_edge- **telegram_send_message** (botToken, chatId, message, parseMode?, disableWebPagePreview?) — Send a Telegram bot message
- **run_saved_workflow** (workflowName or workflowId, task?) — Execute a saved Aiz workflow
- **clipboard_read** () — Read current clipboard text content. Essential for extracting data from apps.
- **clipboard_write** (text) — Write text to clipboard. Use to prepare data for pasting into apps.
- **wait_ms** (ms) — Wait/delay for the specified milliseconds (100–30000). Use after navigation, app launch, or page load.
- **activate_application** (name) — Bring an app to the foreground/focus. Use when switching between apps.

Examples:
- Click at coordinates: \`{"tool": "click_at", "arguments": {"x": 450, "y": 300}}\`
- Take full screenshot: \`{"tool": "screenshot", "arguments": {}}\`
- Type text: \`{"tool": "type_text", "arguments": {"text": "Hello World"}}\`
- Launch app: \`{"tool": "launch_application", "arguments": {"name": "Calculator"}}\`
- Copy from clipboard: \`{"tool": "clipboard_read", "arguments": {}}\`
- Wait for page load: \`{"tool": "wait_ms", "arguments": {"ms": 2000}}\`
- Switch to app: \`{"tool": "activate_application", "arguments": {"name": "Notes"}}\`

**CRITICAL: Multi-step Execution**
You MUST break tasks into sequential tool calls and output ALL tool calls in a single response.
Do NOT just describe what you will do — actually output the tool calls.
For example, to open a website (if no browser is already running):
\`\`\`tool_call
{"tool": "launch_application", "arguments": {"name": "Google Chrome"}}
\`\`\`
\`\`\`tool_call
{"tool": "press_key_combo", "arguments": {"keys": "command+l"}}
\`\`\`
\`\`\`tool_call
{"tool": "type_text", "arguments": {"text": "https://www.youtube.com\\n"}}
\`\`\`

**Multi-App Workflow Pattern (e.g., Read from Gmail → Write to Notes):**
When tasks span multiple applications, follow this pattern:
1. Launch/activate the SOURCE app (e.g., Google Chrome)
2. Navigate to the content (URL, menus, search)
3. Wait for content to load: \`wait_ms\` with 2000-3000ms
4. Take a screenshot to see the current state
5. Select the content you need (click + drag, or Cmd+A, etc.)
6. Copy with Cmd+C, then read it: \`clipboard_read\`
7. Switch to the DESTINATION app: \`activate_application\`
8. Wait briefly: \`wait_ms\` with 500ms
9. Position cursor (click where you want to type/paste)
10. Paste with Cmd+V or use \`type_text\` with the clipboard content
11. Take a screenshot to verify

**Workflow for automating a UI:**
1. Use screenshot or get_screen_size to see the screen
2. Analyze the screenshot to find where to interact
3. Use click_at, type_text, or other tools to perform actions
4. Take another screenshot to verify the result
5. Repeat until the task is complete

**Window resize and controls:**
- To move or resize windows: use get_active_window_edges, then drag title bar or edge points.
- To maximize/minimize/close: use window_control_action first, or use screenshot + click_at if visual state differs.

**Skills:**
When the user asks you to save something as a skill/automation, respond with:
\`\`\`save_skill
{"name": "Skill Name", "prompt": "The full prompt that triggers this automation"}
\`\`\`

Always be helpful, concise, and proactive.\`;ntil the task is complete

**Window resize and controls:**
- To move or resize windows: use get_active_window_edges, then drag title bar or edge points.
- To maximize/minimize/close: use window_control_action first, or use screenshot + click_at if visual state differs.

**Skills:**
When the user asks you to save something as a skill/automation, respond with:
\`\`\`save_skill
{"name": "Skill Name", "prompt": "The full prompt that triggers this automation"}
\`\`\`

Always be helpful, concise, and proactive.`;

function buildSkillAwareSystemPrompt(): string {
  let prompt = SYSTEM_PROMPT;

  const chatSkills = savedSkills.filter((skill) => skill.kind !== "aiz-workflow");
  if (chatSkills.length > 0) {
    const skillLines = chatSkills
      .slice(0, 30)
      .map((skill) => `- ${skill.name}: ${skill.prompt.replace(/\s+/g, " ").trim().slice(0, 220)}`)
      .join("\n");
    prompt += `\n\n**Saved skills available in this workspace:**\n${skillLines}\n\nWhen the user asks to run a saved skill, match by skill name and execute the mapped prompt as tool-driven desktop automation.`;
  }

  if (savedAizWorkflows.length > 0) {
    const workflowLines = savedAizWorkflows
      .slice(0, 40)
      .map((workflow) => `- ${workflow.name} (id: ${workflow.id})`)
      .join("\n");
    prompt += `\n\n**Saved Aiz workflows available:**\n${workflowLines}\n\nWhen the user asks to run, execute, play, or use one of these workflows, call:\n\`\`\`tool_call\n{"tool": "run_saved_workflow", "arguments": {"workflowName": "<workflow name>", "task": "<optional user request context>"}}\n\`\`\`\nUse the workflow id instead of workflowName when the user names an id.`;
  }

  if (mcpToolRegistry.size > 0) {
    const serverGroups = new Map<string, Array<{ name: string; description: string }>>();
    for (const [toolName, entry] of mcpToolRegistry) {
      let list = serverGroups.get(entry.server);
      if (!list) { list = []; serverGroups.set(entry.server, list); }
      list.push({ name: toolName, description: entry.description });
    }
    const mcpSection = Array.from(serverGroups.entries())
      .map(([server, tools]) => {
        const toolLines = tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n");
        return `**${server}:**\n${toolLines}`;
      })
      .join("\n\n");
    prompt += `\n\n**MCP server tools available (use these when relevant to the user's task):**\n${mcpSection}\n\nTo call an MCP tool, use a \`tool_call\` code block with the server name:\n\`\`\`tool_call\n{"tool": "<tool_name>", "server": "<server_name>", "arguments": {<args>}}\n\`\`\`\nAlways include the "server" field for MCP tools so they route to the correct server.`;
  }

  return prompt;
}

// Build the full system prompt with self-evolving context injected
function buildEvolvedSystemPrompt(userMessage: string): string {
  let prompt = buildSkillAwareSystemPrompt();

  // Inject proven step memory for similar tasks (Karpathy ratchet pattern)
  const provenContext = evolveGetProvenContext(userMessage);
  if (provenContext) {
    prompt += `\n\n**Self-Evolving Memory (proven steps from past successful runs):**\n${provenContext}\nUse these proven steps as guidance but adapt to the current screen state. Only follow steps that match the current UI.`;
  }

  // Inject Self-Learning program profile if any saved profile name appears in
  // the user's request — gives the coder a head-start with control names,
  // shortcuts, and what each one does for this program.
  const profileContext = exploreFindProfileForMessage(userMessage);
  if (profileContext) {
    prompt += `\n\n**Self-Learning Program Knowledge:**\n${profileContext}\nPrefer these known controls and shortcuts over guessing. The coordinates still come from the live vision map per iteration.`;
  }

  // Inject 2-sentence UI context if available
  if (evolveLastUISummary) {
    prompt += `\n\n**Current UI State (2-sentence snapshot):**\n${evolveLastUISummary}`;
  }

  return prompt;
}

// Match the user's message against saved program profiles. Returns the most
// specific (longest-name) match's formatted context, or null.
function exploreFindProfileForMessage(userMessage: string): string | null {
  const store = exploreLoadProfiles();
  const names = Object.keys(store.profiles);
  if (names.length === 0) return null;
  const msg = userMessage.toLowerCase();
  let bestKey = "";
  for (const key of names) {
    if (msg.includes(key) && key.length > bestKey.length) bestKey = key;
  }
  if (!bestKey) return null;
  return exploreGetProfileContext(store.profiles[bestKey].programName);
}

// ── Helpers ──
function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
}
function showToast(toastEl: HTMLDivElement, message: string, type: "success" | "error" = "success"): void {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  setTimeout(() => { toastEl.className = "toast hidden"; }, 3000);
}

function scrollOutputToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

// ── AI reply rendering ──
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strip private chain-of-thought / reasoning blocks that some models leak.
function stripThinking(s: string): string {
  return s
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/<reasoning[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<\|begin_of_thought\|>[\s\S]*?<\|end_of_thought\|>/gi, "")
    .replace(/<\|im_start\|>thought[\s\S]*?<\|im_end\|>/gi, "")
    .trim();
}

// Minimal, safe Markdown -> HTML for assistant messages.
// Supports: code fences, inline code, bold, italic, links, headings, bullet/number lists, paragraphs.
function renderMarkdown(input: string): string {
  const src = stripThinking(input);
  if (!src) return "";

  // Pull out fenced code blocks first so their contents aren't formatted.
  const codeBlocks: string[] = [];
  let withoutFences = src.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
    const html = `<pre class="code-block"><code${langClass}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
    codeBlocks.push(html);
    return `\u0000CB${codeBlocks.length - 1}\u0000`;
  });

  // Escape the rest before applying inline formatting so user/model HTML is inert.
  let escaped = escapeHtml(withoutFences);

  // Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, (_, c) => `<code class="inline-code">${c}</code>`);

  // Bold then italic (order matters for ** and *)
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // Markdown links [text](url)
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Block-level: headings, lists, paragraphs
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.join(" ")}</p>`);
      para = [];
    }
  };
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeLists(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); closeLists();
      const lvl = heading[1].length;
      out.push(`<h${lvl} class="md-h${lvl}">${heading[2]}</h${lvl}>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }

    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${ol[2]}</li>`);
      continue;
    }

    closeLists();
    para.push(line);
  }
  flushPara();
  closeLists();

  let html = out.join("\n");
  // Restore code blocks
  html = html.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)] || "");
  return html;
}

// Render markdown into a message bubble.
function setAssistantContent(el: HTMLDivElement, raw: string): void {
  el.innerHTML = renderMarkdown(raw);
  stickChatToBottom();
}

// Auto-scroll the chat log to the bottom when the agent emits new output.
// Only sticks if the user is already near the bottom — if they scrolled up to
// inspect history, leave them where they are.
function stickChatToBottom(force = false): void {
  if (!chatLogEl) return;
  const distanceFromBottom = chatLogEl.scrollHeight - chatLogEl.scrollTop - chatLogEl.clientHeight;
  if (force || distanceFromBottom < 160) {
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }
}

// ── Chat UI ──
function appendMessage(role: "user" | "assistant" | "system", content: string): HTMLDivElement {
  const msg = document.createElement("article");
  msg.className = `msg ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "You" : role === "assistant" ? "AI" : "System";
  const body = document.createElement("div");
  body.className = "msg-body";
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  if (role === "assistant") {
    contentDiv.innerHTML = renderMarkdown(content);
    contentDiv.dataset.raw = stripThinking(content);
  } else {
    contentDiv.textContent = content;
  }
  const time = document.createElement("time");
  time.className = "msg-time";
  time.textContent = formatTime();
  time.setAttribute("datetime", new Date().toISOString());
  body.appendChild(contentDiv);
  body.appendChild(time);
  msg.appendChild(avatar);
  msg.appendChild(body);
  chatLogEl.appendChild(msg);
  stickChatToBottom(true);
  return contentDiv;
}

function appendThinking(): HTMLDivElement {
  const el = appendMessage("assistant", "");
  el.innerHTML = `<span class="thinking-loader">
    <span class="neon-loader" aria-hidden="true">
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
    </span>
    <span>Working...</span>
  </span>`;
  return el;
}

// ── vLLM Streaming Chat ──
async function streamChat(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const model = getCoderModel();
  const url = `${AI_CODER_URL}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`vLLM error: ${response.status} ${response.statusText} [model=${model} url=${url}] ${errorBody.substring(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) fullText += delta;
      } catch { /* skip malformed chunks */ }
    }
  }
  return fullText;
}

async function completeChatJson(messages: ChatMessage[]): Promise<string> {
  const model = getCoderModel();
  const url = `${AI_CODER_URL}/v1/chat/completions`;
  const basePayload = {
    model,
    messages,
    stream: false,
    temperature: 0,
    max_tokens: 4096,
  };

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...basePayload,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(basePayload),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`vLLM error: ${response.status} ${response.statusText} [model=${model} url=${url}] ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  const choiceText = data?.choices?.[0]?.text;
  if (typeof choiceText === "string" && choiceText.trim().length > 0) return choiceText;
  const outText = data?.output_text;
  if (typeof outText === "string" && outText.trim().length > 0) return outText;
  return JSON.stringify(data);
}

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor as FunctionConstructor;

function inferCustomNodeSampleValue(key: string, label = "", hint = ""): string {
  const normalized = `${key} ${label} ${hint}`.toLowerCase();
  if (/(url|link|website|endpoint|api)/.test(normalized)) return "https://example.com";
  if (/(dir|directory|folder|path|workspace)/.test(normalized)) return "/tmp";
  if (/(file|filename|name)/.test(normalized)) return "sample.txt";
  if (/(query|search|keyword|term)/.test(normalized)) return "sample search";
  if (/(selector|css)/.test(normalized)) return "h1,h2,a";
  if (/(limit|count|max|size|number|depth)/.test(normalized)) return "10";
  if (/(format|type)/.test(normalized)) return "text";
  if (/(content|text|body|message|prompt)/.test(normalized)) return "Sample content";
  return `sample ${label || key}`;
}

function extractConfigKeysFromCode(code: string): string[] {
  const keys = new Set<string>();
  const dotAccess = /\bconfig\.([a-zA-Z_$][\w$]*)/g;
  const bracketAccess = /\bconfig\s*\[\s*["'`]([^"'`]+)["'`]\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = dotAccess.exec(code)) !== null) keys.add(match[1]);
  while ((match = bracketAccess.exec(code)) !== null) keys.add(match[1]);
  return [...keys];
}

function buildSampleConfig(fields: CustomNodeConfigField[], code = "", hint = ""): Record<string, string> {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  const sample: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "number") {
      sample[field.key] = inferCustomNodeSampleValue(field.key, field.label, hint);
    } else if (field.type === "select") {
      sample[field.key] = field.options?.[0] || "sample";
    } else {
      sample[field.key] = field.placeholder || inferCustomNodeSampleValue(field.key, field.label, hint);
    }
  }

  for (const key of extractConfigKeysFromCode(code)) {
    const field = fieldByKey.get(key);
    sample[key] = sample[key] || inferCustomNodeSampleValue(key, field?.label, hint);
  }

  return new Proxy(sample, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (prop in target) return target[prop];
      return inferCustomNodeSampleValue(prop, "", hint);
    },
  });
}

function buildSampleWorkflowOutput(code: string, hint = ""): string {
  const normalized = `${code} ${hint}`.toLowerCase();
  if (/json\.parse\s*\(\s*output|output.*json/.test(normalized)) {
    return JSON.stringify({
      title: "Sample Result",
      url: "https://example.com",
      items: [
        { name: "Sample item one", value: "alpha" },
        { name: "Sample item two", value: "beta" },
      ],
      summary: "Sample previous node JSON output",
    });
  }
  if (/domparser|queryselector|html|scrap|page|browser|youtube|video/.test(normalized)) {
    return "<html><head><title>Sample Page</title></head><body><h1>Sample Video Title</h1><a href=\"/watch?v=abc123\">Sample link</a><p>Sample page text for extraction.</p></body></html>";
  }
  if (/csv|split\s*\(\s*["'`]\\n/.test(normalized)) {
    return "name,value\nSample item one,alpha\nSample item two,beta";
  }
  if (/file|directory|folder|path/.test(normalized)) {
    return JSON.stringify(["sample.txt", "notes.md", "report.json"]);
  }
  return "Sample previous node output";
}

function createMockFetchResponse(body: string, url = "https://example.com"): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
    json: async () => ({ title: "Sample Page", content: body, items: ["sample"] }),
    blob: async () => new Blob([body], { type: "text/html" }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    formData: async () => new FormData(),
    clone: () => createMockFetchResponse(body, url),
    redirected: false,
    type: "basic",
    body: null,
    bodyUsed: false,
  } as Response;
}

function createMockInvoke(sampleOutput: string) {
  return async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    const name = String(command).toLowerCase();
    if (name.includes("save_file")) return "/tmp/sample-output.txt";
    if (name.includes("read_file") || name.includes("file_read")) return sampleOutput;
    if (name.includes("directory") || name.includes("list_dir") || name.includes("read_dir")) {
      return ["sample.txt", "notes.md", "report.json"];
    }
    if (name.includes("running_programs")) return [{ name: "Google Chrome", pid: 123, title: "Sample Browser" }];
    if (name.includes("installed_applications")) return [{ name: "Google Chrome" }, { name: "Finder" }];
    if (name.includes("screen_size")) return { width: 1440, height: 900 };
    if (name.includes("screen_region") || name.includes("screenshot")) return { data: "", width: 1440, height: 900 };
    if (name.includes("active_window")) return { x: 0, y: 0, width: 1200, height: 800, title: "Sample Window" };
    if (name.includes("call_mcp_tool")) return { content: [{ text: sampleOutput }], result: sampleOutput };
    if (name.includes("terminal") || name.includes("execute")) return "sample command output";
    if (name.includes("launch") || name.includes("activate") || name.includes("click") || name.includes("type") || name.includes("press")) return { ok: true };
    return { ok: true, command, args, result: sampleOutput };
  };
}

function findUnsupportedCustomNodeApi(code: string): string | null {
  const unsupportedPatterns: Array<[RegExp, string]> = [
    [/\brequire\s*\(/, "require()"],
    [/\bimport\s+[\s\S]*?\bfrom\b/, "import"],
    [/\bmodule\.exports\b/, "module.exports"],
    [/\bexports\./, "exports"],
    [/\bprocess\./, "process"],
    [/\bBuffer\b/, "Buffer"],
    [/\b__dirname\b/, "__dirname"],
    [/\b__filename\b/, "__filename"],
    [/\bfs\./, "fs"],
    [/\bpath\./, "path"],
    [/\bcheerio\b/, "cheerio"],
    [/\bjsdom\b/, "jsdom"],
  ];
  for (const [pattern, label] of unsupportedPatterns) {
    if (pattern.test(code)) return label;
  }
  return null;
}

async function validateCustomNodeCode(
  code: string,
  configFields: CustomNodeConfigField[],
  simulationHint = ""
): Promise<CustomNodeValidationResult> {
  const trimmedCode = code.trim();
  if (!trimmedCode) return { ok: false, error: "Execution code is required." };
  const unsupportedApi = findUnsupportedCustomNodeApi(trimmedCode);
  if (unsupportedApi) {
    return { ok: false, error: `Execution code cannot use Node.js API ${unsupportedApi}. Use browser APIs such as fetch, DOMParser, URL, JSON, RegExp, and string parsing.` };
  }

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = AsyncFunction("config", "output", "fetch", "invoke", trimmedCode) as (...args: unknown[]) => Promise<unknown>;
  } catch (err) {
    return { ok: false, error: `Execution code syntax error: ${err}` };
  }

  const sampleOutput = buildSampleWorkflowOutput(trimmedCode, simulationHint);
  const mockFetch = async (input?: RequestInfo | URL) => createMockFetchResponse(sampleOutput, String(input || "https://example.com"));
  const mockInvoke = createMockInvoke(sampleOutput);

  try {
    const result = await Promise.race([
      fn(buildSampleConfig(configFields, trimmedCode, simulationHint), sampleOutput, mockFetch, mockInvoke),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Execution test timed out after 2 seconds.")), 2000)),
    ]);
    if (result == null) return { ok: false, error: "Execution code must return a string or value." };
    return { ok: true, output: String(result) };
  } catch (err) {
    return { ok: false, error: `Execution test failed: ${err}` };
  }
}

function isCustomNodeCodeSyntacticallyValid(code: string): boolean {
  try {
    if (findUnsupportedCustomNodeApi(code)) return false;
    AsyncFunction("config", "output", "fetch", "invoke", code.trim());
    return code.trim().length > 0;
  } catch {
    return false;
  }
}

// ── Vision Chat (multimodal with image) ──
interface VisionContent { type: "text" | "image_url"; text?: string; image_url?: { url: string }; }
interface VisionMessage { role: "system" | "user" | "assistant"; content: string | VisionContent[]; }

async function streamVisionChat(messages: VisionMessage[]): Promise<string> {
  const model = getVisionModel();
  const url = `${AI_VISION_URL}/v1/chat/completions`;
  const basePayload = {
    model,
    messages,
    stream: false,
    temperature: 0,
    max_tokens: 16384,
  };

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...basePayload,
      response_format: { type: "json_object" },
    }),
  });

  // Compatibility fallback for servers that don't support response_format.
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(basePayload),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Vision API error: ${response.status} ${response.statusText} [model=${model} url=${url}] ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((part: any) => (part && typeof part.text === "string") ? part.text : "")
      .filter((t: string) => t.length > 0);
    if (textParts.length > 0) return textParts.join("\n");
  }
  const choiceText = data?.choices?.[0]?.text;
  if (typeof choiceText === "string" && choiceText.trim().length > 0) return choiceText;
  const outText = data?.output_text;
  if (typeof outText === "string" && outText.trim().length > 0) return outText;
  const reasoning = data?.choices?.[0]?.message?.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim().length > 0) return reasoning;
  try {
    return JSON.stringify(data);
  } catch {
    // fall through
  }
  return "";
}

async function captureScreen(): Promise<string | null> {
  try {
    // Hide the Catog window before capture so the workflow output panel
    // does not appear in the screenshot and confuse the vision model.
    try { await invoke("hide_own_window"); } catch { /* ok if not supported */ }
    // Brief delay so the window manager finishes the minimize animation.
    await new Promise((r) => setTimeout(r, 350));

    const size = await invoke<ScreenSize>("get_screen_size");
    const region = await invoke<ScreenRegion>("read_screen_region", {
      x: 0, y: 0, width: size.width, height: size.height,
    });

    // Restore the Catog window after capture (don't await — let it happen in background).
    invoke("show_own_window").catch(() => { /* ok */ });

    return region.data || null;
  } catch {
    // Restore on error too
    invoke("show_own_window").catch(() => { /* ok */ });
    return null;
  }
}

/**
 * Robust JSON extraction from vision model responses.
 * Handles multiple formats: markdown code blocks, plain JSON, malformed responses.
 */
function extractJsonFromResponse(response: string): any {
  if (!response || response.trim().length === 0) {
    throw new Error("Empty response");
  }

  const extractBalancedJson = (text: string): string | null => {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        if (depth > 0) depth--;
        if (depth === 0 && start !== -1) {
          return text.substring(start, i + 1);
        }
      }
    }
    return null;
  };

  // Strategy 1: Extract from markdown code blocks (```json ... ```)
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    const balancedInCode = extractBalancedJson(codeBlockMatch[1]);
    if (balancedInCode) {
      try {
        return JSON.parse(balancedInCode);
      } catch {
        // Continue to next strategy
      }
    }
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 2: Find first complete JSON object using brace matching
  const balanced = extractBalancedJson(response);
  if (balanced) {
    try {
      return JSON.parse(balanced);
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Clean up common malformations and try parsing
  let cleaned = response
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/^[^{]*/, "") // Remove leading non-JSON text
    .replace(/[^}]*$/, "") // Remove trailing non-JSON text
    .trim();

  // Handle extra quotes: {" {" {"action" -> {"action"
  cleaned = cleaned.replace(/\{\s*"\s*\{\s*"\s*\{/g, "{");
  cleaned = cleaned.replace(/"\s*\}\s*"\s*\}/g, "}");
  
  // Remove duplicate opening braces
  cleaned = cleaned.replace(/^\{\s*\{/, "{");
  
  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue to next strategy
  }

  // Strategy 4: Try to extract key-value pairs manually for simple cases
  const actionMatch = response.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch) {
    const result: any = { action: actionMatch[1] };
    
    // Extract other common fields
    const xMatch = response.match(/"x"\s*:\s*(\d+)/);
    const yMatch = response.match(/"y"\s*:\s*(\d+)/);
    const textMatch = response.match(/"text"\s*:\s*"([^"]+)"/);
    const keysMatch = response.match(/"keys"\s*:\s*"([^"]+)"/);
    const keyMatch = response.match(/"key"\s*:\s*"([^"]+)"/);
    const summaryMatch = response.match(/"summary"\s*:\s*"([^"]+)"/);
    
    if (xMatch) result.x = parseInt(xMatch[1], 10);
    if (yMatch) result.y = parseInt(yMatch[1], 10);
    if (textMatch) result.text = textMatch[1];
    if (keysMatch) result.keys = keysMatch[1];
    if (keyMatch) result.key = keyMatch[1];
    if (summaryMatch) result.summary = summaryMatch[1];
    
    return result;
  }

  // All strategies failed
  throw new Error(`Failed to extract valid JSON. Response preview: ${response.substring(0, 100)}`);
}

/**
 * Legacy vision-only agent: vision model sees AND decides AND emits action JSON.
 * One {action: ...} JSON per iteration. Kept as a selectable mode for users who
 * prefer the simpler single-model loop.
 */
async function runVisionOnlyAgent(opts: {
  task: string;
  appContext: string;
  maxIterations: number;
  log: (msg: string, color?: string) => void;
  isStopped: () => boolean;
}): Promise<string> {
  const { task, appContext, maxIterations, log, isStopped } = opts;

  const visionSystemPrompt = `You are a desktop automation agent. You see screenshots of a computer screen.
Your task: ${task}
${appContext ? `Target application: ${appContext}` : ""}

You can perform these actions, ONE per response in this exact JSON format:

{"action": "click", "x": <pixel_x>, "y": <pixel_y>}
  Click the mouse at screen coordinates. Use this to focus a text field, open a menu, or select a button before typing.

{"action": "type", "text": "<text_to_type>"}
  Type text into the currently focused field. Include \\n to press Enter after typing.

{"action": "hotkey", "keys": "<combo>"}
  Press a keyboard shortcut. Examples: "cmd+c", "cmd+v", "cmd+l", "cmd+f", "cmd+t".

{"action": "key", "key": "<key_name>"}
  Press a single key. Use: "enter", "tab", "escape", "space", "delete", "up", "down", "left", "right".

{"action": "done", "summary": "<what was accomplished>"}
  Task is complete or cannot proceed. Always end with this.

Rules:
- Return ONLY the JSON object, no other text, no markdown.
- To type into a field: FIRST click the field, THEN type the text.
- To submit a form or URL: end the text with \\n to press Enter.
- Coordinates are exact pixel positions in the screenshot.
- Only return {"action": "done"} when the task is fully complete or impossible.`;

  const activate = async () => {
    if (!appContext) return;
    try { await invoke("activate_application", { name: appContext }); } catch { }
    await new Promise((r) => setTimeout(r, 300));
  };

  let summary = "";
  for (let iter = 0; iter < maxIterations; iter++) {
    if (isStopped()) break;
    log(`Vision iteration ${iter + 1}/${maxIterations}: capturing screen...`, "#38bdf8");
    const screenshotBase64 = await captureScreen();
    if (!screenshotBase64) { log(`Vision iteration ${iter + 1}: screenshot failed`, "#ef4444"); break; }

    const visionMessages: VisionMessage[] = [
      { role: "system", content: visionSystemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
          { type: "text", text: iter === 0 ? `Task: ${task}` : "I performed the action. Here is the current screen. What should I do next?" },
        ],
      },
    ];

    // Retry logic for vision API calls (up to 3 attempts)
    let visionResponse: string = "";
    let apiSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        visionResponse = await streamVisionChat(visionMessages);
        apiSuccess = true;
        break;
      } catch (e) {
        const errMsg = String(e).substring(0, 140);
        if (attempt < 3) {
          log(`Vision API attempt ${attempt}/3 failed: ${errMsg}, retrying...`, "#f59e0b");
          await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
        } else {
          log(`Vision model error after 3 attempts: ${errMsg}`, "#ef4444");
        }
      }
    }
    if (!apiSuccess) break;

    log(`Vision: ${visionResponse.substring(0, 160)}`, "#a78bfa");

    // Robust JSON extraction with multiple fallback strategies
    let action: { action?: string; x?: number; y?: number; text?: string; keys?: string; key?: string; summary?: string };
    try {
      action = extractJsonFromResponse(visionResponse);
    } catch (parseErr) {
      log(`Vision parse error: ${String(parseErr).substring(0, 80)}`, "#f59e0b");
      log(`Raw response: ${visionResponse.substring(0, 200)}`, "#6b7280");
      continue;
    }

    if (action.action === "done") {
      summary = action.summary || "Vision task completed";
      log(`Vision Agent complete: ${summary}`, "#22c55e");
      return summary;
    } else if (action.action === "click" && typeof action.x === "number" && typeof action.y === "number") {
      await activate();
      await invoke("click_at", { x: action.x, y: action.y });
      log(`Clicked at (${action.x}, ${action.y})`, "#22c55e");
      await new Promise((r) => setTimeout(r, 800));
    } else if (action.action === "type" && typeof action.text === "string") {
      await activate();
      await invoke("type_text", { text: action.text });
      log(`Typed: "${action.text.substring(0, 60)}"`, "#22c55e");
      await new Promise((r) => setTimeout(r, 500));
    } else if (action.action === "hotkey" && typeof action.keys === "string") {
      await activate();
      await invoke("press_key_combo", { keys: action.keys });
      log(`Hotkey: ${action.keys}`, "#22c55e");
      await new Promise((r) => setTimeout(r, 500));
    } else if (action.action === "key" && typeof action.key === "string") {
      await activate();
      await invoke("press_key_combo", { keys: action.key });
      log(`Key: ${action.key}`, "#22c55e");
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!summary) {
    summary = "Vision Agent: max iterations reached without completion";
    log(summary, "#f59e0b");
  }
  return summary;
}

/**
 * Vision-guided agent loop: vision model SEES the screen and describes it,
 * then the coder model DECIDES the next tool calls and the executor runs them.
 *
 * Pipeline per iteration:
 *   1. Capture screen.
 *   2. Vision model returns a structured perception report (UI elements + coords + state).
 *   3. Coder model receives task + perception + history, emits native tool calls.
 *   4. Tool calls are executed via parseToolCalls (same path as chat agent).
 *   5. Loop until the coder says "done" or max iterations.
 */
async function runVisionGuidedAgent(opts: {
  task: string;
  appContext: string;
  maxIterations: number;
  log: (msg: string, color?: string) => void;
  isStopped: () => boolean;
}): Promise<string> {
  const { task, appContext, maxIterations, log, isStopped } = opts;
  let lastVisionMapRaw = "";
  let lastOsActiveWindowBounds: string | null = null;
  let lastToolSummary = "";

  const buildArtifact = (summaryText: string): string => {
    const parts: string[] = [];
    parts.push(`Summary: ${summaryText}`);
    if (lastOsActiveWindowBounds) {
      parts.push(`OS active window bounds: ${lastOsActiveWindowBounds}`);
    }
    if (lastToolSummary) {
      parts.push(`Last executed tool results:\n${lastToolSummary}`);
    }
    if (lastVisionMapRaw) {
      parts.push(`Vision coordinate map (full JSON):\n${lastVisionMapRaw}`);
    }
    return parts.join("\n\n");
  };

  const visionSystem =
    "You are a UNIVERSAL UI COORDINATE + TEXT MAPPER for desktop automation.\n" +
    "Return EXACTLY ONE valid JSON object and nothing else. No markdown, no prose, no code fences.\n\n" +
    "Measure from screenshot top-left (0,0). Coordinates must be integer pixels inside image bounds.\n" +
    "Bounding boxes use {x, y, width, height} where (x, y) is the top-left corner.\n" +
    "Center coordinates {x, y} are the click center of the element.\n\n" +
    "Required output schema:\n" +
    "{\n" +
    "  \"program\": { \"name\": string|null, \"title\": string|null },\n" +
    "  \"screenshot\": { \"width\": number, \"height\": number },\n" +
    "  \"window\": {\n" +
    "    \"x\": number|null, \"y\": number|null, \"width\": number|null, \"height\": number|null,\n" +
    "    \"focused\": boolean|null\n" +
    "  },\n" +
    "  \"tools\": [\n" +
    "    { \"name\": string, \"x\": number, \"y\": number, \"width\": number|null, \"height\": number|null, \"type\": string, \"enabled\": boolean, \"visible\": boolean }\n" +
    "  ],\n" +
    "  \"text_blocks\": [\n" +
    "    { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"role\": string }\n" +
    "  ],\n" +
    "  \"sentences\": [\n" +
    "    { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number }\n" +
    "  ],\n" +
    "  \"words\": [\n" +
    "    { \"text\": string, \"x\": number, \"y\": number, \"width\": number, \"height\": number }\n" +
    "  ],\n" +
    "  \"columns\": [\n" +
    "    { \"name\": string|null, \"index\": number, \"x\": number, \"y\": number, \"width\": number, \"height\": number }\n" +
    "  ],\n" +
    "  \"rows\": [\n" +
    "    { \"index\": number, \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"cells\": [string] }\n" +
    "  ]\n" +
    "}\n\n" +
    "Extraction rules — capture ALL of the program's visible details so the coder has complete context:\n" +
    "- tools[] : every interactive control (buttons, tabs, menu items, toolbar icons, checkboxes, radio buttons, dropdowns, sliders, inputs/textfields, links, scrollbars, titlebar buttons). Name them by their visible label or icon meaning.\n" +
    "- text_blocks[] : every visible block of static text (headings, paragraphs, labels, status bars, tooltips). role can be: heading | paragraph | label | caption | status | tooltip | menu_text | list_item.\n" +
    "- sentences[] : split paragraphs into individual sentences with their own bounding boxes. One entry per sentence visible on screen.\n" +
    "- words[] : every visible word with its bounding box. Treat each token as one entry. This is the OCR-level granularity — include EVERY word the screen shows in the active window.\n" +
    "- columns[] / rows[] : if the active window contains a table, list view, grid, spreadsheet, or column layout (file explorer, mail list, dataset, code editor with line numbers), extract every column header and every row with cell text. Use index 0-based.\n" +
    "- IMPORTANT: extract ONLY from the active target program window named in the user request; ignore other windows / background UI / desktop wallpaper.\n" +
    "- Be exhaustive. The coder model relies on this map for every click, type, and read decision — missing elements force re-perception loops.\n" +
    "- Return direct coordinate/content values; do not describe actions or recommend solutions.\n" +
    "- Caps: tools[] ≤ 250, text_blocks[] ≤ 200, sentences[] ≤ 200, words[] ≤ 600, columns[] ≤ 50, rows[] ≤ 200. If you must truncate, prioritize items in the active interaction area.\n" +
    "- Set arrays to [] when not applicable. Set nullable scalar fields to null. Always return one valid JSON object.";

  const coderSystem =
    "You are a PRECISION desktop automation EXECUTOR. You receive:\n" +
    "  (a) the user's task,\n" +
    "  (b) a JSON map from vision with: tools[] (interactive controls {name,x,y,type}), text_blocks[] (static UI text + bbox), sentences[] (sentence-level text + bbox), words[] (word-level OCR + bbox), columns[]/rows[] (table layout), and window/screenshot metadata,\n" +
    "  (c) the active window bounds from the OS (get_active_window_bounds),\n" +
    "  (d) the history of actions taken so far.\n\n" +
    "Use text_blocks/sentences/words to READ the screen content (verify state, locate labels next to fields, confirm dialog messages) and tools[] to INTERACT. Use columns/rows for table-driven tasks (pick a row by its cell text, click a column header).\n\n" +
    "Your job: emit 1-3 tool calls that advance the task, using coordinates from the vision map VERBATIM.\n\n" +
    "The coder plans the sequential task. The vision model only supplies direct UI coordinate/content values for the selected program window.\n\n" +
    "=== OUTPUT FORMAT ===\n" +
    "Tool calls use this exact format (no MCP server field):\n" +
    "```tool_call\n{\"tool\": \"tool_name\", \"arguments\": {\"key\": \"value\"}}\n```\n\n" +
    "=== AVAILABLE TOOLS ===\n\n" +
    "Clicking & Pressing:\n" +
    "  click_at (x, y)                        — Click at screen pixel coordinates\n" +
    "  long_press_at (x, y, duration_ms)      — Long press (hold click) at coordinates for N ms (default 500)\n" +
    "  double_click_at (x, y)                 — Double-click at coordinates\n" +
    "  right_click_at (x, y)                  — Right-click at coordinates\n\n" +
    "Typing & Keys:\n" +
    "  type_text (text)                       — Type text at current focus. End with \\n to press Enter.\n" +
    "  press_key_combo (keys)                 — Press key combo: \"ctrl+c\", \"command+l\", \"alt+f4\", \"return\"\n\n" +
    "Scrolling & Dragging:\n" +
    "  scroll_at (x, y, direction, amount)    — Scroll at coordinates. direction: \"up\"/\"down\"/\"left\"/\"right\"\n" +
    "  drag (from_x, from_y, to_x, to_y, duration_ms) — Drag from A to B\n\n" +
    "Window Management:\n" +
    "  window_control_action (action)         — action: \"maximize_window\" | \"minimize_window\" | \"close_window\" | \"restore_window\"\n" +
    "  resize_window (window_id, width, height) — Resize window to exact pixel dimensions\n" +
    "  move_window (window_id, x, y)          — Move window top-left corner to (x,y)\n" +
    "  get_active_window_bounds ()            — Get focused window {x, y, width, height}\n" +
    "  get_active_window_edges ()             — Get window edge midpoints for drag-resize\n\n" +
    "Screen & Apps:\n" +
    "  screenshot ()                          — Capture full screen (triggers re-perception next iteration)\n" +
    "  get_screen_size ()                     — Screen resolution {width, height}\n" +
    "  launch_application (name)              — Launch app by name\n" +
    "  get_running_programs ()                — List running programs with PIDs and window titles\n\n" +
    "Integrations:\n" +
    "  telegram_send_message (botToken, chatId, message, parseMode?, disableWebPagePreview?) — Send a Telegram bot message\n\n" +
    "=== EXECUTION PATTERNS ===\n\n" +
    "Clicking elements:\n" +
    "  1. Find target in tools[] by name (case-insensitive, partial match OK), fallback to type.\n" +
    "  2. Call click_at with that element's {x, y} EXACTLY — do NOT add offsets or adjustments.\n" +
    "  3. For right-click: use right_click_at. For long press (context menus, drag start): use long_press_at.\n\n" +
    "Typing into fields:\n" +
    "  1. FIRST click_at the textfield/searchbox/addressbar to focus it.\n" +
    "  2. THEN type_text the value. End with \\n to press Enter and submit.\n" +
    "  3. NEVER type without clicking first unless focus.label already matches the target field.\n\n" +
    "Window control:\n" +
    "  - Prefer tools[] entries whose names include minimize/maximize/close when available.\n" +
    "  - OR use window_control_action for direct OS control.\n\n" +
    "Window move — drag the title bar:\n" +
    "  - drag(window.x + window.width/2, window.y + 14, target_x, target_y, 300)\n\n" +
    "Bootstrap when map is sparse/empty:\n" +
    "  - If tools[] includes bootstrap entries (window_center/content_center), click one first, then continue sequential task actions.\n" +
    "  - Do not stop only because there are few controls; proceed with best-next action.\n\n" +
    "Browser address bar:\n" +
    "  - press_key_combo \"command+l\" (macOS) or \"ctrl+l\" (Windows/Linux) to focus address bar.\n" +
    "  - Then type_text the URL ending in \\n.\n\n" +
    "=== CRITICAL RULES ===\n" +
    "- NEVER invent or estimate coordinates. ONLY use values from the vision JSON map or OS window bounds.\n" +
    "- If target is not in tools[], emit screenshot() to trigger re-perception.\n" +
    "- If window.focused is false, first re-focus the target app with activate_application or launch_application.\n" +
    "- Use long_press_at for context menus, drag initiation, and long-hold interactions.\n\n" +
    "=== COMPLETION ===\n" +
    "- When the task is finished, output exactly: TASK_DONE: <one-line summary>  (no tool calls).\n" +
    "- Do NOT explain your reasoning. Emit tool calls or TASK_DONE." +
    (appContext
      ? `\n\nTarget application: "${appContext}". It is already launched and focused. Do not relaunch it.`
      : "");

  const history: { role: "user" | "assistant"; content: string }[] = [];
  let lastSummary = "";
  let consecutiveScreenshotOnlySteps = 0;

  const isPlaceholderDoneSummary = (summary: string): boolean => {
    const s = summary.trim().toLowerCase();
    if (!s) return true;
    if (s.includes("<summary>") || s.includes("[summary]")) return true;
    if (/^<[^>]+>[\"'.]*$/.test(s)) return true;
    if (/^summary[\s:.-]*$/.test(s)) return true;
    return false;
  };

  const buildUniversalVisionMap = (raw: any, fallbackProgramName: string): any => {
    const toNum = (v: unknown): number | null => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
      if (typeof v === "string") {
        const n = Number(v.trim());
        if (Number.isFinite(n)) return Math.round(n);
      }
      return null;
    };
    const tools: Array<{ name: string; x: number; y: number; type: string; enabled: boolean; visible: boolean }> = [];
    const pushTool = (name: string, x: unknown, y: unknown, type: string, enabled = true, visible = true): void => {
      const nx = toNum(x);
      const ny = toNum(y);
      if (nx === null || ny === null) return;
      if (!name || !name.trim()) return;
      tools.push({ name: name.trim(), x: nx, y: ny, type, enabled, visible });
    };

    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    for (const el of elements) {
      const label = typeof el?.label === "string" && el.label.trim().length > 0 ? el.label.trim() : (typeof el?.type === "string" ? el.type : "tool");
      pushTool(label, el?.x, el?.y, typeof el?.type === "string" ? el.type : "tool", el?.enabled !== false, el?.visible !== false);
    }

    const titlebarButtons = raw?.window?.titlebar_buttons;
    if (titlebarButtons && typeof titlebarButtons === "object") {
      pushTool("Minimize", titlebarButtons?.minimize?.x, titlebarButtons?.minimize?.y, "titlebar_button");
      pushTool("Maximize", titlebarButtons?.maximize?.x, titlebarButtons?.maximize?.y, "titlebar_button");
      pushTool("Close", titlebarButtons?.close?.x, titlebarButtons?.close?.y, "titlebar_button");
    }

    const seen = new Set<string>();
    const deduped = tools.filter((t) => {
      const k = `${t.name.toLowerCase()}@${t.x},${t.y}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 250);

    const programName =
      (typeof raw?.program?.name === "string" && raw.program.name.trim()) ||
      (typeof raw?.window?.app === "string" && raw.window.app.trim()) ||
      (fallbackProgramName || null);
    const programTitle =
      (typeof raw?.program?.title === "string" && raw.program.title.trim()) ||
      (typeof raw?.window?.title === "string" && raw.window.title.trim()) ||
      null;

    const normalizeBoxArray = (
      arr: unknown,
      cap: number,
      requireText: boolean,
      extra?: (item: any, out: Record<string, unknown>) => void,
    ): Array<Record<string, unknown>> => {
      if (!Array.isArray(arr)) return [];
      const out: Array<Record<string, unknown>> = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const x = toNum((item as any).x);
        const y = toNum((item as any).y);
        if (x === null || y === null) continue;
        const text = typeof (item as any).text === "string" ? (item as any).text : "";
        if (requireText && !text.trim()) continue;
        const entry: Record<string, unknown> = {
          text,
          x,
          y,
          width: toNum((item as any).width),
          height: toNum((item as any).height),
        };
        if (extra) extra(item, entry);
        out.push(entry);
        if (out.length >= cap) break;
      }
      return out;
    };

    const textBlocks = normalizeBoxArray(raw?.text_blocks, 200, true, (item, out) => {
      out.role = typeof (item as any).role === "string" ? (item as any).role : "text";
    });
    const sentences = normalizeBoxArray(raw?.sentences, 200, true);
    const words = normalizeBoxArray(raw?.words, 600, true);
    const columns = normalizeBoxArray(raw?.columns, 50, false, (item, out) => {
      out.name = typeof (item as any).name === "string" ? (item as any).name : null;
      out.index = toNum((item as any).index);
    });
    const rows: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw?.rows)) {
      for (const r of raw.rows) {
        if (!r || typeof r !== "object") continue;
        const x = toNum((r as any).x);
        const y = toNum((r as any).y);
        if (x === null || y === null) continue;
        rows.push({
          index: toNum((r as any).index),
          x,
          y,
          width: toNum((r as any).width),
          height: toNum((r as any).height),
          cells: Array.isArray((r as any).cells)
            ? (r as any).cells.map((c: unknown) => (typeof c === "string" ? c : String(c ?? ""))).slice(0, 50)
            : [],
        });
        if (rows.length >= 200) break;
      }
    }

    return {
      program: { name: programName, title: programTitle },
      screenshot: {
        width: toNum(raw?.screenshot?.width),
        height: toNum(raw?.screenshot?.height),
      },
      window: {
        x: toNum(raw?.window?.x),
        y: toNum(raw?.window?.y),
        width: toNum(raw?.window?.width),
        height: toNum(raw?.window?.height),
        focused: typeof raw?.window?.focused === "boolean" ? raw.window.focused : null,
      },
      tools: deduped,
      text_blocks: textBlocks,
      sentences,
      words,
      columns,
      rows,
      raw,
    };
  };

  const hasActionableTools = (map: any): boolean => {
    const tools = Array.isArray(map?.tools) ? map.tools : [];
    if (tools.length < 3) return false;
    return tools.some((t: any) => {
      if (!t || t.visible === false || t.enabled === false) return false;
      const name = typeof t.name === "string" ? t.name.toLowerCase() : "";
      const type = typeof t.type === "string" ? t.type.toLowerCase() : "";
      return ["button", "textfield", "searchbox", "tab", "menu", "toolbar", "icon", "input"].some((k) => name.includes(k) || type.includes(k));
    });
  };

  const isStartupSparseButUsable = (map: any): boolean => {
    const tools = Array.isArray(map?.tools) ? map.tools : [];
    if (tools.length === 0 || tools.length > 8) return false;
    const keywordHit = tools.some((t: any) => {
      const name = typeof t?.name === "string" ? t.name.toLowerCase() : "";
      return ["new", "open", "home", "blank", "document", "start", "recent", "template"].some((k) => name.includes(k));
    });
    return keywordHit;
  };

  const enrichWithBootstrapTools = (map: any, bounds: { x: number; y: number; width: number; height: number } | null): any => {
    if (!bounds) return map;
    const tools = Array.isArray(map?.tools) ? [...map.tools] : [];
    if (tools.length > 0) return map;
    const cx = Math.round(bounds.x + bounds.width / 2);
    const cy = Math.round(bounds.y + bounds.height / 2);
    const contentY = Math.round(bounds.y + Math.max(40, bounds.height * 0.35));
    tools.push(
      { name: "window_center", x: cx, y: cy, type: "bootstrap", enabled: true, visible: true },
      { name: "content_center", x: cx, y: contentY, type: "bootstrap", enabled: true, visible: true },
      { name: "content_top_left", x: Math.round(bounds.x + 80), y: Math.round(bounds.y + 120), type: "bootstrap", enabled: true, visible: true }
    );
    return {
      ...map,
      window: {
        ...(map?.window || {}),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      tools,
    };
  };

  const hasBootstrapTools = (map: any): boolean => {
    const tools = Array.isArray(map?.tools) ? map.tools : [];
    return tools.some((t: any) => typeof t?.type === "string" && t.type === "bootstrap");
  };

  const isTargetProgramMatch = (detectedName: unknown, targetName: string): boolean => {
    if (!targetName || !targetName.trim()) return true;
    if (typeof detectedName !== "string") return false;
    const detected = detectedName.trim().toLowerCase();
    const target = targetName.trim().toLowerCase();
    return detected.includes(target) || target.includes(detected);
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    if (isStopped()) break;
    log(`Iteration ${iter + 1}/${maxIterations}: capturing screen...`, "#38bdf8");

    const screenshot = await captureScreen();
    if (!screenshot) {
      log(`Iteration ${iter + 1}: screenshot failed`, "#ef4444");
      break;
    }

    // 1. Vision model extracts coordinates as JSON (with retry logic).
    let perception: string = "";
    let visionSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        perception = await streamVisionChat([
          { role: "system", content: visionSystem },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
              {
                type: "text",
                text:
                  `Extract the coordinate map for this screen. ` +
                  `Active target program: ${appContext || "unknown"}. ` +
                  `Return coordinates ONLY for controls visible in that target program window. ` +
                  `Ignore desktop/background/other app windows. ` +
                  `Task context (do not act on it, only use to decide which elements matter): ${task}`
              },
            ],
          },
        ]);
        visionSuccess = true;
        break;
      } catch (e) {
        const errMsg = String(e).substring(0, 140);
        if (attempt < 3) {
          log(`Vision API attempt ${attempt}/3 failed: ${errMsg}, retrying...`, "#f59e0b");
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } else {
          log(`Vision model error after 3 attempts: ${errMsg}`, "#ef4444");
        }
      }
    }
    if (!visionSuccess) break;
    // Extract pure JSON payload — strip code fences, prose, and <think> blocks.
    const jsonMatch = perception.match(/```(?:json)?\s*([\s\S]*?)```/);
    const rawJson = (jsonMatch ? jsonMatch[1] : perception)
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
    let parsedVision: any | null = null;
    try {
      const extracted = extractJsonFromResponse(perception);
      parsedVision = (extracted && typeof extracted === "object") ? extracted as {
        screenshot?: { width?: number; height?: number };
        elements?: Array<unknown>;
      } : null;
    } catch {
      parsedVision = null;
    }
    if (!parsedVision) {
      const perceptionPreview = perception.replace(/\s+/g, " ").trim().substring(0, 220);
      if (perceptionPreview) {
        log(`Vision raw preview: ${perceptionPreview}`, "#f59e0b");
      }

      // Salvage pass: ask coder model to reformat raw vision text into strict JSON.
      try {
        const repairedJsonText = await streamChat([
          {
            role: "system",
            content:
              "You are a JSON normalizer. Convert the provided vision text into ONE valid JSON object only. " +
              "No markdown, no explanation. Preserve coordinates and labels."
          },
          {
            role: "user",
            content:
              "Reformat this vision output into valid JSON object:\n\n" + perception.substring(0, 12000)
          }
        ]);
        const repaired = extractJsonFromResponse(repairedJsonText);
        if (repaired && typeof repaired === "object") {
          parsedVision = repaired;
          log("Vision JSON repair pass succeeded.", "#22c55e");
        }
      } catch {
        // continue with recapture path below
      }

      // Second salvage: ask vision model itself to convert its previous text into strict JSON.
      if (!parsedVision && perception.trim().length > 0) {
        try {
          const visionRepair = await streamVisionChat([
            {
              role: "system",
              content:
                "Convert the user's text into ONE strict JSON object only. " +
                "No markdown, no prose, no comments."
            },
            {
              role: "user",
              content: `Convert to strict JSON object:\n${perception.substring(0, 12000)}`
            }
          ]);
          const repairedByVision = extractJsonFromResponse(visionRepair);
          if (repairedByVision && typeof repairedByVision === "object") {
            parsedVision = repairedByVision;
            log("Vision self-repair pass succeeded.", "#22c55e");
          }
        } catch {
          // keep recapture behavior
        }
      }

      if (!parsedVision) {
        const lowerPreview = perceptionPreview.toLowerCase();
        if (
          lowerPreview.includes("cannot") &&
          (lowerPreview.includes("image") || lowerPreview.includes("vision") || lowerPreview.includes("multimodal"))
        ) {
          log("Vision model appears text-only or image input is rejected; check Vision model setting.", "#ef4444");
        }
        log("Vision output was not valid JSON; recapturing next iteration.", "#f59e0b");
        history.push({
          role: "user",
          content: "Vision map was malformed JSON. Re-measure screenshot and return one strict JSON object only."
        });
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
    }
    // Gather OS bounds early so empty/weak vision maps can be bootstrapped.
    let osBoundsObj: { x: number; y: number; width: number; height: number } | null = null;
    try {
      osBoundsObj = await invoke<{ x: number; y: number; width: number; height: number }>("get_active_window_bounds");
    } catch {
      osBoundsObj = null;
    }

    const universalVisionMap = enrichWithBootstrapTools(buildUniversalVisionMap(parsedVision, appContext || ""), osBoundsObj);
    const screenshotWidth = universalVisionMap?.screenshot?.width;
    const screenshotHeight = universalVisionMap?.screenshot?.height;
    const elementsCount = Array.isArray(universalVisionMap?.tools) ? universalVisionMap.tools.length : 0;
    const mapActionable = hasActionableTools(universalVisionMap);
    const startupSparseUsable = isStartupSparseButUsable(universalVisionMap);
    const bootstrapUsable = hasBootstrapTools(universalVisionMap);
    const targetProgramMatched = isTargetProgramMatch(universalVisionMap?.program?.name, appContext || "");
    const screenMapForCoder = JSON.stringify(universalVisionMap);
    lastVisionMapRaw = screenMapForCoder;
    const screenMapPreview = rawJson.length > 4000
      ? rawJson.substring(0, 4000) + "\n...[truncated for log preview]"
      : rawJson;
    log(`Vision map: ${screenMapPreview.substring(0, 160).replace(/\s+/g, " ")}...`, "#38bdf8");
    if (typeof screenshotWidth === "number" && typeof screenshotHeight === "number") {
      log(`Vision measured screenshot ${screenshotWidth}x${screenshotHeight} with ${elementsCount} interactive element(s).`, "#38bdf8");
    }
    if (!targetProgramMatched) {
      log(`Vision detected program '${String(universalVisionMap?.program?.name || "unknown")}', expected '${appContext}'. Re-capturing target window only.`, "#f59e0b");
      history.push({
        role: "user",
        content:
          `Scope correction: target program is '${appContext}'. ` +
          "Return tools[] only for this program window and ignore all other windows."
      });
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    if (!mapActionable && !startupSparseUsable && !bootstrapUsable) {
      log("Vision map has low actionable confidence; requesting denser tool coordinates.", "#f59e0b");
      history.push({
        role: "user",
        content:
          `Perception quality is low for target program '${appContext}'. ` +
          "Re-measure that target window only and provide more actionable controls in tools[] (buttons, inputs, menu items, tabs) with exact x/y coordinates."
      });
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    if (!mapActionable && bootstrapUsable) {
      log("Vision map is empty/weak; using bootstrap coordinates from active window bounds.", "#22c55e");
      history.push({
        role: "user",
        content:
          "Perception returned empty/weak map. Start execution with bootstrap tools (window_center/content_center), " +
          "then take concrete sequential actions for the task."
      });
    }
    if (!mapActionable && startupSparseUsable) {
      log("Startup UI detected (few controls). Proceeding with available coordinates.", "#22c55e");
      history.push({
        role: "user",
        content:
          "The target app is on a startup screen with few controls. Execute sequentially using available tools[] coordinates (e.g., New/Blank document/Open/Home) instead of requesting more tools."
      });
    }

    if (isStopped()) break;

    // 2. Gather OS window bounds for coordinate sanity.
    let osActiveWindowBounds: string | null = null;
    try {
      osActiveWindowBounds = osBoundsObj ? JSON.stringify(osBoundsObj) : null;
    } catch {
      osActiveWindowBounds = null;
    }
    lastOsActiveWindowBounds = osActiveWindowBounds;

    // 3. Coder model decides tool calls using the coordinate map.
    const coderUserContent =
      `User task: ${task}\n\n` +
      `Program + tools coordinate map (JSON from vision module — use these coordinates verbatim):\n` +
      "```json\n" + screenMapForCoder + "\n```\n\n" +
      (osActiveWindowBounds
        ? `OS active window bounds (authoritative geometry from native API):\n${osActiveWindowBounds}\n\n`
        : "") +
      (history.length > 0
        ? `Action history so far:\n${history.map((h, i) => `[${i + 1}] ${h.role}: ${h.content.substring(0, 220)}`).join("\n")}\n\n`
        : "") +
      `Decide the next tool calls. Pick coordinates from tools[] by tool name/type. ` +
      `Do not call screenshot() when tools[] already contains actionable targets for this step. ` +
      `Execute concrete progress actions (click/type/key) toward the user task. ` +
      `If needed, cross-check with OS bounds. If the task is finished, output TASK_DONE: <summary>.`;

    // 4. Coder model with retry logic
    let coderResponse: string = "";
    let coderSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        coderResponse = await streamChat([
          { role: "system", content: coderSystem },
          { role: "user", content: coderUserContent },
        ]);
        coderSuccess = true;
        break;
      } catch (e) {
        const errMsg = String(e).substring(0, 140);
        if (attempt < 3) {
          log(`Coder API attempt ${attempt}/3 failed: ${errMsg}, retrying...`, "#f59e0b");
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } else {
          log(`Coder model error after 3 attempts: ${errMsg}`, "#ef4444");
        }
      }
    }
    if (!coderSuccess) break;

    history.push({ role: "user", content: `Screen JSON snippet: ${screenMapPreview.substring(0, 240)}` });
    history.push({ role: "assistant", content: coderResponse.substring(0, 600) });

    // 3. Done?
    const doneMatch = /TASK_DONE\s*:\s*(.+)/i.exec(coderResponse);
    if (doneMatch) {
      const candidateSummary = doneMatch[1].trim();
      if (isPlaceholderDoneSummary(candidateSummary)) {
        log("Coder reported TASK_DONE with placeholder summary; continuing execution.", "#f59e0b");
        history.push({
          role: "user",
          content:
            "Do not use placeholder completion text. Continue with concrete tool calls using exact coordinates from tools[] " +
            "until the user task is visibly complete, then output TASK_DONE with a specific one-line result."
        });
        await new Promise((r) => setTimeout(r, 200));
        continue;
      } else {
        lastSummary = candidateSummary;
        log(`Task complete: ${lastSummary}`, "#22c55e");
        return buildArtifact(lastSummary);
      }
    }

    // 4. Execute tool calls. The native focus path will activate appContext if supplied.
    if (isStopped()) break;
    let toolResults = await parseToolCalls(coderResponse, appContext || undefined);
    if (toolResults.length === 0) {
      // Repair round: coder response was not parseable as tool_call and did not emit TASK_DONE.
      // Ask for strict reformat instead of ending the workflow early.
      let repairedResponse = "";
      try {
        repairedResponse = await streamChat([
          { role: "system", content: coderSystem },
          {
            role: "user",
            content:
              "Your previous response did not contain parseable tool_call blocks and did not mark completion. " +
              "Re-emit ONLY one of the following:\n" +
              "1) One to three valid tool_call fenced blocks in the exact format, OR\n" +
              "2) TASK_DONE: <one-line summary>\n\n" +
              `User task: ${task}\n` +
              (appContext ? `Target application: ${appContext}\n` : "") +
              "Do not include explanations or prose."
          },
          { role: "assistant", content: coderResponse }
        ]);
      } catch {
        repairedResponse = "";
      }

      if (repairedResponse) {
        const repairedDoneMatch = /TASK_DONE\s*:\s*(.+)/i.exec(repairedResponse);
        if (repairedDoneMatch) {
          const candidateSummary = repairedDoneMatch[1].trim();
          if (!isPlaceholderDoneSummary(candidateSummary)) {
            lastSummary = candidateSummary;
            log(`Task complete: ${lastSummary}`, "#22c55e");
            return buildArtifact(lastSummary);
          }
          log("Coder repair pass returned placeholder TASK_DONE; continuing iteration.", "#f59e0b");
        }
        toolResults = await parseToolCalls(repairedResponse, appContext || undefined);
        if (toolResults.length > 0) {
          log("Coder reformat pass recovered actionable tool calls.", "#22c55e");
          history.push({ role: "assistant", content: repairedResponse.substring(0, 600) });
        }
      }

      if (toolResults.length === 0) {
        log("Coder produced no tool calls after repair pass; continuing with fresh vision iteration.", "#f59e0b");
        lastSummary = coderResponse.replace(/```[\s\S]*?```/g, "").trim().substring(0, 300);
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
    }
    log(`Step ${iter + 1} — executed ${toolResults.length} tool call(s)`, "#22c55e");
    lastToolSummary = toolResults
      .map((tr) => `${tr.server_name}/${tr.tool_name}: ${tr.result.substring(0, 240)}`)
      .join("\n");
    for (const tr of toolResults) {
      log(`✅ ${tr.server_name}/${tr.tool_name}: ${tr.result.substring(0, 140)}`, "#22c55e");
    }
    if (toolResults.length > 0 && toolResults.every((tr) => tr.tool_name === "screenshot")) {
      consecutiveScreenshotOnlySteps++;
      if (mapActionable) {
        history.push({
          role: "user",
          content:
            "Avoid screenshot-only output now. Use tools[] coordinates to perform the next concrete action (click/type/key) for the task."
        });
      }
      if (consecutiveScreenshotOnlySteps >= 2) {
        history.push({
          role: "user",
          content:
            "Constraint: avoid repeated screenshot-only turns. Next response must include concrete action on the current UI " +
            "(e.g., click_at on target element coordinate, then type_text if needed), unless task is complete."
        });
      }
    } else {
      consecutiveScreenshotOnlySteps = 0;
    }
    // Settle so the next screenshot reflects the action.
    await new Promise((r) => setTimeout(r, 600));
  }

  if (!lastSummary) {
    lastSummary = "Vision-guided agent: max iterations reached without completion";
    log(lastSummary, "#f59e0b");
  }
  return buildArtifact(lastSummary);
}

// ── MCP Tool Registry ──
// Maps MCP tool names to their server name and description.
// Rebuilt after every fetchMcpServers() / handleSaveMcp() call.
let mcpToolRegistry: Map<string, { server: string; description: string }> = new Map();

function rebuildMcpToolRegistry(servers: McpServerStatus[]): void {
  mcpToolRegistry.clear();
  for (const server of servers) {
    if (!server.connected) continue;
    for (const tool of server.tools) {
      mcpToolRegistry.set(tool.name, { server: server.name, description: tool.description });
    }
  }
}

// ── Parse tool calls from AI response ──
interface ToolCallResult { server_name: string; tool_name: string; result: string }

// Auto-route tool names to native Tauri commands or MCP servers
const NATIVE_DESKTOP_TOOLS = new Set([
  "click_at", "long_press_at", "scroll_at", "drag",
  "type_text", "press_key_combo", "screenshot",
  "get_screen_size", "launch_application", "get_running_programs",
  "get_installed_applications", "get_active_window_bounds", "get_active_window_edges",
  "window_control_action", "long_press", "scroll", "maximize_window", "minimize_window", "close_window",
  // Clipboard tools — essential for cross-app data transfer
  "clipboard_read", "clipboard_write",
  // Wait tool — allows explicit delays for page loads etc.
  "wait_ms",
  // App switching
  "activate_application",
  // Agent tools — window management
  "agent_get_active_window", "agent_get_all_windows", "agent_get_window_by_title",
  "agent_resize_window", "agent_move_window", "agent_minimize_window", "agent_maximize_window",
  "agent_restore_window", "agent_close_window", "agent_focus_window",
  // Agent tools — mouse
  "agent_click_at", "agent_click_mouse", "agent_double_click", "agent_right_click_at",
  "agent_drag_mouse", "agent_move_mouse", "agent_scroll",
  // Agent tools — keyboard
  "agent_type_text", "agent_press_key", "agent_press_key_combo",
  // Agent tools — apps
  "agent_launch_app", "agent_get_screen_size", "agent_get_mouse_position",
  // File operation tools
  "read_file", "write_file", "list_directory", "create_directory",
  "delete_path", "move_path", "copy_path", "file_exists", "execute_command",
  // Integrations
  "telegram_send_message", "telegram_get_updates",
  // Workflow orchestration
  "run_saved_workflow",
]);

const NATIVE_TOOL_ALIASES: Record<string, string> = {
  click: "click_at",
  type: "type_text",
  press_key: "press_key_combo",
  key_combo: "press_key_combo",
  long_press: "long_press_at",
  scroll: "scroll_at",
  maximize_window: "window_control_action",
  minimize_window: "window_control_action",
  close_window: "window_control_action",
  restore_window: "window_control_action",
  right_click_at: "agent_click_at",
  double_click_at: "agent_double_click",
  resize_window: "agent_resize_window",
  move_window: "agent_move_window",
};

function normalizeToolName(toolName: string): string {
  return NATIVE_TOOL_ALIASES[toolName] || toolName;
}

const NATIVE_ARG_ALIASES: Record<string, Record<string, string>> = {
  launch_application: { app: "name", application: "name", app_name: "name", program: "name" },
  type_text: { content: "text", value: "text", input: "text", string: "text", message: "text" },
  press_key_combo: { key: "keys", key_combo: "keys", shortcut: "keys", combo: "keys", combination: "keys" },
  click_at: { posX: "x", pos_x: "x", cx: "x", posY: "y", pos_y: "y", cy: "y" },
  long_press_at: { posX: "x", pos_x: "x", posY: "y", pos_y: "y", duration: "duration_ms", durationMs: "duration_ms", ms: "duration_ms" },
  scroll_at: { posX: "x", pos_x: "x", posY: "y", pos_y: "y", scroll_direction: "direction", scrollDirection: "direction", dir: "direction", scroll_amount: "amount", scrollAmount: "amount", ticks: "amount" },
  drag: { start_x: "from_x", startX: "from_x", sx: "from_x", fromX: "from_x", start_y: "from_y", startY: "from_y", sy: "from_y", fromY: "from_y", end_x: "to_x", endX: "to_x", ex: "to_x", toX: "to_x", end_y: "to_y", endY: "to_y", ey: "to_y", toY: "to_y", duration: "duration_ms", durationMs: "duration_ms", ms: "duration_ms" },
  save_file: { filename: "filename", data: "content", body: "content", filetype: "format", ext: "format" },
  window_control_action: { type: "action", window_action: "action" },
  agent_click_at: { posX: "x", pos_x: "x", cx: "x", posY: "y", pos_y: "y", cy: "y" },
  agent_double_click: { posX: "x", pos_x: "x", cx: "x", posY: "y", pos_y: "y", cy: "y" },
  agent_right_click_at: { posX: "x", pos_x: "x", cx: "x", posY: "y", pos_y: "y", cy: "y" },
  agent_drag_mouse: { start_x: "from_x", startX: "from_x", sx: "from_x", fromX: "from_x", start_y: "from_y", startY: "from_y", sy: "from_y", fromY: "from_y", end_x: "to_x", endX: "to_x", ex: "to_x", toX: "to_x", end_y: "to_y", endY: "to_y", ey: "to_y", toY: "to_y", duration: "duration_ms", durationMs: "duration_ms", ms: "duration_ms" },
  agent_scroll: { posX: "x", pos_x: "x", posY: "y", pos_y: "y", scroll_direction: "direction", scrollDirection: "direction", dir: "direction", scroll_amount: "amount", scrollAmount: "amount", ticks: "amount" },
  agent_type_text: { content: "text", value: "text", input: "text", string: "text" },
  agent_press_key_combo: { key: "keys", key_combo: "keys", shortcut: "keys", combo: "keys" },
  agent_resize_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_move_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_focus_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_minimize_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_maximize_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_restore_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_close_window: { windowId: "window_id", wid: "window_id", id: "window_id" },
  agent_launch_app: { app: "name", application: "name", app_name: "name", program: "name" },
  telegram_send_message: {
    botToken: "botToken",
    bot_token: "botToken",
    token: "botToken",
    chatId: "chatId",
    chat_id: "chatId",
    recipient: "chatId",
    text: "message",
    content: "message",
    body: "message",
    parse_mode: "parseMode",
    disable_web_page_preview: "disableWebPagePreview",
  },
  telegram_get_updates: { botToken: "botToken", bot_token: "botToken", token: "botToken" },
  run_saved_workflow: { name: "workflowName", workflow: "workflowName", workflow_id: "workflowId", id: "workflowId" },
};

const NATIVE_ALIAS_DEFAULT_ARGS: Record<string, Record<string, unknown>> = {
  right_click_at: { button: "right" },
  double_click_at: {},
  restore_window: { action: "restore_window" },
  maximize_window: { action: "maximize_window" },
  minimize_window: { action: "minimize_window" },
  close_window: { action: "close_window" },
};

function normalizeNativeArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeToolName(tool);
  const aliases = NATIVE_ARG_ALIASES[normalized];
  if (!aliases) return args;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    out[aliases[key] || key] = val;
  }
  return out;
}

function normalizeTelegramSendArgs(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeNativeArgs("telegram_send_message", args);
  return {
    botToken: normalized.botToken,
    chatId: normalized.chatId,
    message: normalized.message,
    parseMode: normalized.parseMode,
    disableWebPagePreview: normalized.disableWebPagePreview,
  };
}

function createWorkflowInvoke(): typeof invoke {
  return ((command: string, args?: Record<string, unknown>) => {
    if (command === "telegram_send_message") {
      return invoke(command, normalizeTelegramSendArgs(args || {}));
    }
    return invoke(command, args);
  }) as typeof invoke;
}

function findSavedWorkflow(args: Record<string, unknown>): AizWorkflowRecord | null {
  const workflowId = String(args.workflowId || args.id || "").trim();
  const workflowName = String(args.workflowName || args.name || args.workflow || "").trim();
  if (workflowId) {
    const byId = savedAizWorkflows.find((workflow) => workflow.id === workflowId);
    if (byId) return byId;
  }
  if (!workflowName) return null;
  const needle = workflowName.toLowerCase();
  return savedAizWorkflows.find((workflow) => workflow.name.toLowerCase() === needle)
    || savedAizWorkflows.find((workflow) => workflow.name.toLowerCase().includes(needle) || needle.includes(workflow.name.toLowerCase()))
    || null;
}

async function executeSavedWorkflowFromChat(args: Record<string, unknown>): Promise<string> {
  const workflow = findSavedWorkflow(args);
  if (!workflow) {
    const available = savedAizWorkflows.map((w) => w.name).join(", ") || "none";
    return `Error: saved workflow not found. Available workflows: ${available}`;
  }
  const logEl = appendMessage("system", `Running workflow: ${workflow.name}`);
  await executeWorkflowStandalone(
    workflow.nodes || [],
    workflow.connections || [],
    customNodeTypes,
    logEl,
    { stop: false }
  );
  return `Workflow "${workflow.name}" executed`;
}

function resolveToolServer(toolName: string): string | null {
  const normalized = normalizeToolName(toolName);
  if (NATIVE_DESKTOP_TOOLS.has(toolName) || NATIVE_DESKTOP_TOOLS.has(normalized)) return "native";
  if (/^(browser_|navigate|click_element|tab_)/.test(toolName)) return "chrome";
  const mcpEntry = mcpToolRegistry.get(toolName);
  if (mcpEntry) return mcpEntry.server;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeTypedExpressionText(text: string): string {
  const expressionLike = /^[\d\s,.;:+\-*/÷×xX()=\n]+$/.test(text) && /\d\s*[xX×]\s*\d/.test(text);
  if (!expressionLike) return text;
  return text.replace(/(\d[\d,.\s]*)[xX×](\s*\d)/g, "$1*$2");
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = numberFromUnknown(value[0]);
    const y = numberFromUnknown(value[1]);
    return x !== null && y !== null ? { x, y } : null;
  }
  if (!isRecord(value)) return null;
  const x = numberFromUnknown(value.x ?? value.X ?? value.left ?? value.cx ?? value.centerX ?? value.clientX);
  const y = numberFromUnknown(value.y ?? value.Y ?? value.top ?? value.cy ?? value.centerY ?? value.clientY);
  return x !== null && y !== null ? { x, y } : null;
}

function normalizeSpatialArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const nestedPoint = readPoint(out.coordinates ?? out.coordinate ?? out.position ?? out.point ?? out.location ?? out.center ?? out.target);
  if ((out.x === undefined || out.y === undefined) && nestedPoint) {
    out.x = nestedPoint.x;
    out.y = nestedPoint.y;
  }
  const directPoint = readPoint(out);
  if (directPoint) {
    out.x = Math.round(directPoint.x);
    out.y = Math.round(directPoint.y);
  }

  if (tool === "drag" || tool === "agent_drag_mouse") {
    const from = readPoint(out.from ?? out.start ?? out.source ?? out.origin);
    const to = readPoint(out.to ?? out.end ?? out.destination ?? out.target);
    if (from) {
      out.from_x = Math.round(from.x);
      out.from_y = Math.round(from.y);
    }
    if (to) {
      out.to_x = Math.round(to.x);
      out.to_y = Math.round(to.y);
    }
  }

  return out;
}

async function executeToolCall(server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  if (server === "native") {
    const aliasDefaults = NATIVE_ALIAS_DEFAULT_ARGS[tool];
    let payload: Record<string, unknown> = normalizeNativeArgs(tool, { ...(aliasDefaults || {}), ...args });
    let normalizedTool = normalizeToolName(tool);
    payload = normalizeSpatialArgs(normalizedTool, payload);
    if (NATIVE_TOOL_ALIASES[tool] === "window_control_action") {
      normalizedTool = "window_control_action";
      if (!payload.action) payload.action = tool;
    }
    if (tool === "telegram_send_message" || normalizedTool === "telegram_send_message") {
      const result = await invoke<unknown>("telegram_send_message", normalizeTelegramSendArgs(payload));
      return typeof result === "string" ? result : JSON.stringify(result);
    }
    if (tool === "telegram_get_updates" || normalizedTool === "telegram_get_updates") {
      const result = await invoke<unknown>("telegram_get_updates", normalizeTelegramSendArgs(payload));
      return JSON.stringify(result);
    }
    if (tool === "run_saved_workflow" || normalizedTool === "run_saved_workflow") {
      return executeSavedWorkflowFromChat(payload);
    }
    // Clipboard tools — essential for cross-app data transfer
    if (tool === "clipboard_read" || normalizedTool === "clipboard_read") {
      const text = await invoke<string>("clipboard_read");
      return text || "(clipboard is empty)";
    }
    if (tool === "clipboard_write" || normalizedTool === "clipboard_write") {
      const text = typeof payload.text === "string" ? payload.text : String(payload.text || payload.content || "");
      await invoke("clipboard_write", { text });
      return `Clipboard set: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`;
    }
    // Wait tool — explicit delay for page loads, animations, etc.
    if (tool === "wait_ms" || normalizedTool === "wait_ms") {
      const ms = Math.min(Math.max(Number(payload.ms || payload.duration || payload.delay || 1000), 100), 30000);
      await new Promise((r) => setTimeout(r, ms));
      return `Waited ${ms}ms`;
    }
    // App switching — bring an app to the foreground
    if (tool === "activate_application" || normalizedTool === "activate_application") {
      const appName = typeof payload.name === "string" ? payload.name : String(payload.name || payload.app || "");
      if (!appName) return "Error: activate_application requires a name";
      await invoke("activate_application", { name: appName });
      await new Promise((r) => setTimeout(r, 500));
      return `Activated: ${appName}`;
    }
    if (tool === "double_click_at") {
      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return "Error: double_click_at requires x and y";
      }
      await invoke("agent_move_mouse", { x: Math.round(x), y: Math.round(y) });
      await invoke("agent_double_click");
      return "ok";
    }
    if (normalizedTool === "agent_click_at" && !payload.button) {
      payload.button = "left";
    }
    const pointTools = new Set(["click_at", "long_press_at", "scroll_at", "agent_click_at", "agent_move_mouse"]);
    if (pointTools.has(normalizedTool)) {
      const x = numberFromUnknown(payload.x);
      const y = numberFromUnknown(payload.y);
      if (x === null || y === null) {
        return `Error: ${normalizedTool} requires numeric x and y coordinates. Use screenshot/vision output or pass {x, y}, {coordinates:{x,y}}, {position:{x,y}}, or [x, y].`;
      }
      payload.x = Math.round(x);
      payload.y = Math.round(y);
    }
    if (normalizedTool === "drag" || normalizedTool === "agent_drag_mouse") {
      for (const key of ["from_x", "from_y", "to_x", "to_y"]) {
        const value = numberFromUnknown(payload[key]);
        if (value === null) {
          return `Error: ${normalizedTool} requires numeric from_x, from_y, to_x, and to_y coordinates. You can pass nested {from:{x,y}, to:{x,y}} or {start:{x,y}, end:{x,y}}.`;
        }
        payload[key] = Math.round(value);
      }
    }
    const tauriCommand = normalizedTool === "screenshot" ? "read_screen_region" : normalizedTool;
    if (tool === "screenshot" && !payload.width && !payload.height) {
      const size = await invoke<{ width: number; height: number }>("get_screen_size");
      payload.x = 0;
      payload.y = 0;
      payload.width = size.width;
      payload.height = size.height;
    }
    const focusTools = new Set([
      "click_at", "long_press_at", "scroll_at", "drag", "type_text", "press_key_combo", "window_control_action",
      "agent_click_at", "agent_click_mouse", "agent_double_click", "agent_drag_mouse", "agent_move_mouse",
      "agent_scroll", "agent_type_text", "agent_press_key", "agent_press_key_combo",
    ]);
    const targetApp = typeof payload._targetApp === "string" ? payload._targetApp : "";
    if ((normalizedTool === "type_text" || normalizedTool === "agent_type_text") && typeof payload.text === "string") {
      payload.text = normalizeTypedExpressionText(payload.text);
    }
    if (focusTools.has(normalizedTool) && targetApp) {
      try { await invoke("activate_application", { name: targetApp }); } catch { }
      await new Promise((r) => setTimeout(r, 500));
      delete payload._targetApp;
    }
    const result = await invoke<unknown>(tauriCommand, payload);
    if (result === null || result === undefined) return "ok";
    if (typeof result === "string") return result;
    const json = JSON.stringify(result);
    if (tool === "screenshot" || normalizedTool === "screenshot" || json.length > 4000) {
      const obj = result as Record<string, unknown>;
      const w = obj.width ?? obj.w ?? "?";
      const h = obj.height ?? obj.h ?? "?";
      return `Screenshot captured (${w}x${h}), ${Math.round(json.length / 1024)}KB base64 data available.`;
    }
    return json;
  }
  if (server === "chrome" && tool === "browser_navigate") {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url) {
      return "Error: browser_navigate requires a url";
    }
    try {
      await invoke("press_key_combo", { keys: "command+l" });
      await invoke("type_text", { text: `${url}\n` });
      return `Navigated via native fallback: ${url}`;
    } catch (fallbackError) {
      return `Error: browser_navigate fallback failed: ${String(fallbackError)}`;
    }
  }
  return invoke<string>("call_mcp_tool", {
    request: { serverName: server, toolName: tool, arguments: args },
  });
}

async function parseToolCalls(text: string, targetApp?: string): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  const seen = new Set<string>();
  const MAX_CALLS = 10;

  const makeCanonicalDedupeKey = (serverName: string, toolName: string, args: Record<string, unknown>): string => {
    const normalizedTool = normalizeToolName(toolName);
    const aliasDefaults = NATIVE_ALIAS_DEFAULT_ARGS[toolName] || {};
    const payload = serverName === "native"
      ? normalizeNativeArgs(toolName, { ...aliasDefaults, ...args })
      : args;
    return `${serverName}:${normalizedTool}:${JSON.stringify(payload)}`;
  };

  const tryCall = async (toolName: string, args: Record<string, unknown>, server?: string) => {
    if (chatStopRequested) return;
    if (results.length >= MAX_CALLS) return;
    const resolvedServer = server || resolveToolServer(toolName);
    if (!resolvedServer) {
      console.warn(`Tool call skipped — unknown server for tool: ${toolName}`);
      return;
    }
    const dedupeKey = makeCanonicalDedupeKey(resolvedServer, toolName, args);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const enrichedArgs = { ...args };
    if (targetApp && resolvedServer === "native") {
      enrichedArgs._targetApp = targetApp;
    }
    try {
      const res = await executeToolCall(resolvedServer, toolName, enrichedArgs);
      if (chatStopRequested) return;
      results.push({ server_name: resolvedServer, tool_name: toolName, result: res });
      // Self-Evolving Engine: record successful step
      evolveRecordStep(toolName, args, res, !res.startsWith("Error:"));
    } catch (e) {
      console.error("Tool call failed:", e);
      const errResult = `Error: ${String(e)}`;
      results.push({ server_name: resolvedServer, tool_name: toolName, result: errResult });
      // Self-Evolving Engine: record failed step
      evolveRecordStep(toolName, args, errResult, false);
    }
  };

  // Format 1: ```tool_call\n{"tool":"...", "server":"...", "arguments":{...}}\n```
  const codeBlockRegex = /```tool_call\s*\n([\s\S]*?)```/g;
  const codeBlockRanges: Array<{ start: number; end: number }> = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (chatStopRequested) break;
    codeBlockRanges.push({ start: match.index, end: match.index + match[0].length });
    try {
      const call = JSON.parse(match[1].trim());
      if (call.tool) {
        await tryCall(call.tool, call.arguments || {}, call.server);
      }
    } catch (e) { console.error("Tool call parse error:", e); }
  }

  const hasToolCallBlocks = codeBlockRanges.length > 0;

  const isInsideToolCallBlock = (index: number): boolean => {
    for (const range of codeBlockRanges) {
      if (index >= range.start && index < range.end) return true;
    }
    return false;
  };

  // Format 2: ["tool_name", {"arg": "value"}]  — raw array the AI often outputs
  if (!hasToolCallBlocks) {
    const rawArrayRegex = /\[\s*"([a-zA-Z0-9_]+)"\s*,\s*(\{[^}]*\})\s*\]/g;
    while ((match = rawArrayRegex.exec(text)) !== null) {
      if (chatStopRequested) break;
      try {
        const toolName = match[1];
        const args = JSON.parse(match[2]);
        if (!isInsideToolCallBlock(match.index)) {
          await tryCall(toolName, args);
        }
      } catch (e) { console.error("Raw array tool call parse error:", e); }
    }
  }

  // Format 3: {"tool": "name", "arguments": {...}} without code block wrapper
  if (!hasToolCallBlocks) {
    const jsonCallRegex = /\{\s*"tool"\s*:\s*"([a-zA-Z0-9_]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g;
    while ((match = jsonCallRegex.exec(text)) !== null) {
      if (chatStopRequested) break;
      try {
        const toolName = match[1];
        const args = JSON.parse(match[2]);
        if (!isInsideToolCallBlock(match.index)) {
          await tryCall(toolName, args);
        }
      } catch (e) { console.error("JSON tool call parse error:", e); }
    }
  }

  return results;
}

function parseSkillSave(text: string): { name: string; prompt: string } | null {
  const regex = /```save_skill\s*\n([\s\S]*?)```/;
  const match = regex.exec(text);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

// ── Main Chat Handler ──
function setSendBtnProcessing(processing: boolean): void {
  if (processing) {
    chatSendBtn.textContent = "Stop";
    chatSendBtn.classList.add("stop");
    chatSendBtn.type = "button"; // prevent form submit when acting as stop
  } else {
    chatSendBtn.textContent = "Send";
    chatSendBtn.classList.remove("stop");
    chatSendBtn.type = "submit";
  }
}

function abortCurrentStream(): void {
  chatStopRequested = true;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  isProcessing = false;
  setSendBtnProcessing(false);
}

async function processUserMessage(userMessage: string, opts: { source?: "chat" | "telegram"; replyToTelegram?: boolean } = {}): Promise<string> {
  if (isProcessing) return "";

  if (!userMessage) return "";

  // Self-Evolving Engine: begin task lifecycle
  evolveBeginTask(userMessage);

  appendMessage("user", opts.source === "telegram" ? `[Telegram] ${userMessage}` : userMessage);
  isProcessing = true;
  chatStopRequested = false;
  setSendBtnProcessing(true);

  const abortController = new AbortController();
  currentAbortController = abortController;
  const processingSessionId = activeSessionId;

  conversationHistory.push({ role: "user", content: userMessage });
  saveSessionById(processingSessionId, conversationHistory);

  // Self-Evolving Engine: only capture a UI snapshot for messages that look like
  // a desktop-automation task. Plain chat must NOT trigger captureScreen() —
  // that hides the Catog window and disrupts the conversation.
  if (looksLikeDesktopAutomationTask(userMessage)) {
    void evolveGet2SentenceUISummary();
  }

  const thinkingEl = appendThinking();
  let finalReply = "";

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: buildEvolvedSystemPrompt(userMessage) },
      ...conversationHistory.slice(-20),
    ];

    const MAX_AGENT_ITERS = 5;
    let agentIter = 0;
    let lastCleanText = "";

    while (agentIter < MAX_AGENT_ITERS) {
      if (abortController.signal.aborted || chatStopRequested) break;
      agentIter++;

      const fullResponse = await streamChat(messages, abortController.signal);

      // Clean tool-call markup and private reasoning from visible text
      const cleanResponse = stripThinking(
        fullResponse
          .replace(/```tool_call[\s\S]*?```/g, "")
          .replace(/```save_skill[\s\S]*?```/g, "")
          .replace(/tool_call\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, "")
          .replace(/\[\s*"[a-zA-Z0-9_]+"\s*,\s*\{[^}]*\}\s*\]/g, "")
          .replace(/\{\s*"tool"\s*:\s*"[a-zA-Z0-9_]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g, "")
      ).trim();
      lastCleanText = cleanResponse;

      // Update thinking bubble with latest response (rendered as markdown)
      if (cleanResponse) {
        setAssistantContent(thinkingEl, cleanResponse);
        thinkingEl.dataset.raw = cleanResponse;
      } else {
        thinkingEl.textContent = `Agent step ${agentIter}...`;
        stickChatToBottom();
      }

      // Push assistant turn into message history for the loop
      messages.push({ role: "assistant", content: fullResponse });

      // Handle skill saving (only on first iteration)
      if (agentIter === 1) {
        const skillSave = parseSkillSave(fullResponse);
        if (skillSave) {
          saveSkill(skillSave.name, skillSave.prompt);
          appendMessage("assistant", `✅ Skill "${skillSave.name}" saved! You can find it in the right panel.`);
        }
      }

      // Execute tool calls
      const toolResults = await parseToolCalls(fullResponse);
      if (chatStopRequested) break;
      if (toolResults.length === 0) break; // no tools → done

      // Show tool results in chat
      for (const tr of toolResults) {
        appendMessage("system", `🔧 [${tr.server_name}] ${tr.tool_name} → ${tr.result}`);
      }

      // Feed tool results back to the AI so it can continue
      const toolSummary = toolResults
        .map((tr) => `${tr.tool_name}: ${tr.result}`)
        .join("\n");
      messages.push({
        role: "user",
        content: `Tool results:\n${toolSummary}\n\nIf the task is not yet complete, continue with the next tool calls. If done, respond with a brief summary.`,
      });
    }

    // Final display — render markdown
    if (lastCleanText) {
      setAssistantContent(thinkingEl, lastCleanText);
      thinkingEl.dataset.raw = lastCleanText;
      finalReply = lastCleanText;
    } else {
      thinkingEl.textContent = "Done.";
      stickChatToBottom();
      finalReply = "Done.";
    }
    // Save the final assistant response to conversation history
    conversationHistory.push({ role: "assistant", content: finalReply });
    saveSessionById(processingSessionId, conversationHistory);
    if (opts.replyToTelegram) {
      await sendTelegramReply(finalReply);
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      thinkingEl.textContent = "⏹ Stopped.";
      thinkingEl.style.color = "#f59e0b";
      stickChatToBottom();
      finalReply = "Stopped.";
    } else {
      thinkingEl.textContent = `⚠️ Error: ${String(error)}\n\nMake sure vLLM is running at ${AI_CODER_URL}`;
      stickChatToBottom();
      finalReply = `Error: ${String(error)}`;
      if (opts.replyToTelegram) {
        await sendTelegramReply(finalReply);
      }
    }
  } finally {
    // ALWAYS reset so the user can send messages again
    currentAbortController = null;
    isProcessing = false;
    chatStopRequested = false;
    setSendBtnProcessing(false);

    // Self-Evolving Engine: end task lifecycle (ratchet commit/revert)
    evolveEndTask();
  }
  return finalReply;
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (isProcessing) return;

  const userMessage = chatInputEl.value.trim();
  if (!userMessage) return;

  chatInputEl.value = "";
  chatInputEl.focus();
  await processUserMessage(userMessage, { source: "chat" });
}

// ── Skills Management ──
function saveSkill(name: string, prompt: string): void {
  const skill: Skill = {
    id: `skill-${Date.now()}`,
    name,
    prompt,
    createdAt: new Date().toISOString(),
  };
  savedSkills.push(skill);
  localStorage.setItem("catog-skills", JSON.stringify(savedSkills));
  renderSkills();
}

function saveAizWorkflows(): void {
  localStorage.setItem(AIZ_WORKFLOWS_KEY, JSON.stringify(savedAizWorkflows));
}

function cloneAizNodes(nodes: AizNode[]): AizNode[] {
  return nodes.map((node) => ({ ...node, config: { ...node.config } }));
}

function cloneAizConnections(connections: AizConnection[]): AizConnection[] {
  return connections.map((connection) => ({ ...connection }));
}

function upsertAizWorkflowSkill(workflow: AizWorkflowRecord): void {
  const existing = savedSkills.find((s) => s.kind === "aiz-workflow" && s.workflowId === workflow.id);
  if (existing) {
    existing.name = workflow.name;
    existing.prompt = `[AIZ_WORKFLOW:${workflow.id}]`;
  } else {
    savedSkills.unshift({
      id: `skill-aiz-${workflow.id}`,
      name: workflow.name,
      prompt: `[AIZ_WORKFLOW:${workflow.id}]`,
      createdAt: workflow.createdAt,
      kind: "aiz-workflow",
      workflowId: workflow.id,
    });
  }
  localStorage.setItem("catog-skills", JSON.stringify(savedSkills));
}

function deleteAizWorkflow(workflowId: string): void {
  savedAizWorkflows = savedAizWorkflows.filter((w) => w.id !== workflowId);
  savedSkills = savedSkills.filter((s) => !(s.kind === "aiz-workflow" && s.workflowId === workflowId));
  saveAizWorkflows();
  localStorage.setItem("catog-skills", JSON.stringify(savedSkills));
  renderSkills();
  renderAizWorkflowList();
}

function renderAizWorkflowList(): void {
  const containers: HTMLDivElement[] = [];
  const builderWorkflowList = document.querySelector("#aiz-builder-workflows-list") as HTMLDivElement | null;
  if (builderWorkflowList) containers.push(builderWorkflowList);
  if (containers.length === 0) return;

  for (const container of containers) {
    container.innerHTML = "";
    if (savedAizWorkflows.length === 0) {
      container.innerHTML = '<p class="skills-empty">No Aiz workflows yet. Save one from the Aiz Skill Builder.</p>';
      continue;
    }

    const sorted = [...savedAizWorkflows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    for (const workflow of sorted) {
      const item = document.createElement("div");
      item.className = "aiz-workflow-item";

      const info = document.createElement("button");
      info.className = "aiz-workflow-open";
      info.innerHTML = `<span class="aiz-workflow-name">⚡ ${workflow.name}</span><span class="aiz-workflow-date">${new Date(workflow.updatedAt).toLocaleDateString()}</span>`;
      info.addEventListener("click", () => {
        if (openAndLoadAizWorkflow) openAndLoadAizWorkflow(workflow.id, false);
      });

      const play = document.createElement("button");
      play.className = "aiz-workflow-play";
      play.innerHTML = "▶";
      play.title = "Play workflow";
      play.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openAndLoadAizWorkflow) openAndLoadAizWorkflow(workflow.id, true);
      });

      const del = document.createElement("button");
      del.className = "aiz-workflow-delete";
      del.innerHTML = "×";
      del.title = "Delete workflow";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteAizWorkflow(workflow.id);
      });

      item.appendChild(info);
      item.appendChild(play);
      item.appendChild(del);
      container.appendChild(item);
    }
  }
}

function renderSkills(): void {
  if (!skillsListEl) return;
  skillsListEl.innerHTML = "";

  if (savedSkills.length === 0) {
    skillsListEl.innerHTML = '<p class="skills-empty">No skills saved yet. Ask the AI to save an automation as a skill!</p>';
    renderAizWorkflowList();
    return;
  }

  const displaySkills = savedSkills.filter((s) => s.kind !== "aiz-workflow");
  if (displaySkills.length === 0) {
    skillsListEl.innerHTML = '<p class="skills-empty">No skills saved yet. Ask the AI to save an automation as a skill!</p>';
    renderAizWorkflowList();
    return;
  }

  for (const skill of displaySkills) {
    const btn = document.createElement("button");
    btn.className = "skill-card";
    btn.innerHTML = `
      <span class="skill-card-name">⚡ ${skill.name}</span>
      <span class="skill-card-date">${new Date(skill.createdAt).toLocaleDateString()}</span>
    `;
    btn.addEventListener("click", () => {
      if (skill.kind === "aiz-workflow" && skill.workflowId && openAndLoadAizWorkflow) {
        openAndLoadAizWorkflow(skill.workflowId, false);
        return;
      }
      if (/^\[AIZ_WORKFLOW:/.test(skill.prompt)) {
        const id = skill.prompt.replace("[AIZ_WORKFLOW:", "").replace("]", "");
        if (openAndLoadAizWorkflow) {
          openAndLoadAizWorkflow(id, false);
          return;
        }
      }
      chatInputEl.value = skill.prompt;
      void handleSubmit(new SubmitEvent("submit"));
    });

    if (skill.kind === "aiz-workflow" && skill.workflowId) {
      const playBtn = document.createElement("button");
      playBtn.className = "skill-play";
      playBtn.innerHTML = "▶";
      playBtn.title = "Play workflow";
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openAndLoadAizWorkflow) openAndLoadAizWorkflow(skill.workflowId!, true);
      });
      btn.appendChild(playBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "skill-delete";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (skill.kind === "aiz-workflow" && skill.workflowId) {
        deleteAizWorkflow(skill.workflowId);
        return;
      }
      savedSkills = savedSkills.filter((s) => s.id !== skill.id);
      localStorage.setItem("catog-skills", JSON.stringify(savedSkills));
      renderSkills();
    });
    btn.appendChild(deleteBtn);
    skillsListEl.appendChild(btn);
  }

  renderAizWorkflowList();
}

// ── Widget Handlers ──
function openWidget(widget: HTMLDivElement): void { widget.classList.remove("hidden"); }
function closeWidgetFn(widget: HTMLDivElement): void { widget.classList.add("hidden"); }

async function fetchMcpServers(): Promise<void> {
  try {
    const servers = await invoke<McpServerStatus[]>("list_mcp_servers");
    rebuildMcpToolRegistry(servers);
    const container = document.querySelector("#mcp-servers-container") as HTMLDivElement;
    if (!container) return;
    container.innerHTML = "";
    if (servers.length === 0) {
      container.innerHTML = '<p class="mcp-servers-empty">No MCP servers configured. Add one in the MCP widget.</p>';
      return;
    }
    for (const server of servers) {
      const item = document.createElement("div");
      item.className = `mcp-server-item ${server.connected ? "connected" : "disconnected"}`;
      const lightClass = server.connected ? "connected" : "disconnected";
      const lightTitle = server.connected ? "Connected" : "Disconnected";
      const errorText = server.error ? `<span class="mcp-server-error">${server.error}</span>` : "";
      const toolsText = server.tools.length > 0 ? `${server.tools.length} tools` : "";
      item.innerHTML = `
        <span class="mcp-server-status-light ${lightClass}" title="${lightTitle}"></span>
        <span class="mcp-server-name">${server.name}</span>
        <span class="mcp-server-tools">${toolsText}</span>
        ${errorText}
        <button class="mcp-retry-btn" title="Retry connection">&#8635;</button>
      `;
      const retryBtn = item.querySelector(".mcp-retry-btn") as HTMLButtonElement;
      retryBtn.addEventListener("click", async () => {
        retryBtn.classList.add("spinning");
        try {
          await invoke("reconnect_mcp_server", { name: server.name });
          await fetchMcpServers();
        } catch (e) {
          console.error("Retry failed:", e);
        } finally {
          retryBtn.classList.remove("spinning");
        }
      });
      container.appendChild(item);
    }
  } catch (e) {
    console.error("Failed to fetch MCP servers:", e);
  }
}

async function handleSaveMcp(): Promise<void> {
  const raw = mcpJsonInput.value.trim();
  if (!raw) { showToast(mcpToast, "Please paste a JSON configuration.", "error"); return; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { showToast(mcpToast, "Invalid JSON format.", "error"); return; }
  const serversObj = (parsed as Record<string, unknown>).mcpServers;
  if (!serversObj || typeof serversObj !== "object") {
    showToast(mcpToast, "JSON must have 'mcpServers' object.", "error"); return;
  }

  const pendingServers: Array<{ name: string; config: AddMcpServerRequest }> = [];
  for (const [name, config] of Object.entries(serversObj as Record<string, unknown>)) {
    const serverConfig = config as Record<string, unknown>;
    pendingServers.push({
      name,
      config: {
        name,
        command: (serverConfig.command as string) || "",
        args: (serverConfig.args as string[]) || [],
        env: (serverConfig.env as Record<string, string>) || {},
      },
    });
  }

  const container = document.querySelector("#mcp-servers-container") as HTMLDivElement;
  if (container) {
    for (const { name } of pendingServers) {
      const item = document.createElement("div");
      item.className = "mcp-server-item installing";
      item.id = `mcp-pending-${name}`;
      item.innerHTML = `
        <span class="mcp-server-status-light installing" title="Connecting..."></span>
        <span class="mcp-server-name">${name}</span>
        <span class="mcp-server-status-text">Connecting...</span>
      `;
      container.appendChild(item);
    }
  }

  mcpJsonInput.value = "";
  closeWidgetFn(mcpWidget);

  for (const { name, config } of pendingServers) {
    try {
      await invoke("add_mcp_server", { request: config });
    } catch (e) {
      console.error(`Failed to add server ${name}:`, e);
    }
  }

  await fetchMcpServers();
  showToast(mcpToast, "MCP server(s) added successfully!", "success");
}

async function sendTelegramReply(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !message.trim()) return;
  const text = message.length > 3500 ? message.substring(0, 3500) + "\n...[truncated]" : message;
  try {
    await invoke("telegram_send_message", {
      botToken: TELEGRAM_BOT_TOKEN,
      chatId: TELEGRAM_CHAT_ID,
      message: text,
    });
  } catch (err) {
    appendMessage("system", `Telegram send error: ${String(err)}`);
  }
}

function updateTelegramStatus(text?: string): void {
  if (!telegramStatus) return;
  const state = TELEGRAM_ENABLED && TELEGRAM_BOT_TOKEN
    ? (TELEGRAM_CHAT_ID ? `Enabled for chat ${TELEGRAM_CHAT_ID}` : "Enabled, waiting for first message")
    : "Disabled";
  telegramStatus.textContent = text || `Telegram chat: ${state}`;
}

async function pollTelegramUpdates(): Promise<void> {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) return;
  if (telegramPollInFlight) return;
  telegramPollInFlight = true;
  try {
    const updates = await invoke<any>("telegram_get_updates", {
      botToken: TELEGRAM_BOT_TOKEN,
      offset: telegramLastUpdateId > 0 ? telegramLastUpdateId + 1 : undefined,
      timeout: 0,
    });
    const result = Array.isArray(updates?.result) ? updates.result : [];
    let processedCount = 0;
    let skippedCount = 0;
    for (const update of result) {
      const updateId = Number(update?.update_id);
      const message = update?.message;
      const chatId = String(message?.chat?.id || "");
      const text = typeof message?.text === "string" ? message.text.trim() : "";
      if (!text || !chatId) {
        if (Number.isFinite(updateId) && updateId > telegramLastUpdateId) {
          telegramLastUpdateId = updateId;
          localStorage.setItem("telegram-last-update-id", String(telegramLastUpdateId));
        }
        continue;
      }
      if (!TELEGRAM_CHAT_ID) {
        TELEGRAM_CHAT_ID = chatId;
        localStorage.setItem("telegram-chat-id", TELEGRAM_CHAT_ID);
        const chatIdEl = document.querySelector("#telegram-chat-id") as HTMLInputElement | null;
        if (chatIdEl) chatIdEl.value = TELEGRAM_CHAT_ID;
        appendMessage("system", `Telegram linked to chat ${TELEGRAM_CHAT_ID}`);
      }
      if (chatId !== TELEGRAM_CHAT_ID) {
        skippedCount++;
        continue;
      }
      if (isProcessing) {
        await sendTelegramReply("CATOG is busy running another task. Send the request again after it finishes.");
        continue;
      }
      processedCount++;
      await processUserMessage(text, { source: "telegram", replyToTelegram: true });
      if (Number.isFinite(updateId) && updateId > telegramLastUpdateId) {
        telegramLastUpdateId = updateId;
        localStorage.setItem("telegram-last-update-id", String(telegramLastUpdateId));
      }
    }
    if (processedCount > 0) {
      updateTelegramStatus(`Telegram chat: processed ${processedCount} message${processedCount === 1 ? "" : "s"}`);
    } else if (skippedCount > 0) {
      updateTelegramStatus(`Telegram chat: skipped ${skippedCount} message${skippedCount === 1 ? "" : "s"} from another chat`);
    } else {
      updateTelegramStatus();
    }
  } catch (err) {
    updateTelegramStatus(`Telegram polling error: ${String(err).substring(0, 120)}`);
  } finally {
    telegramPollInFlight = false;
  }
}

function restartTelegramPolling(): void {
  if (telegramPollTimer) {
    clearInterval(telegramPollTimer);
    telegramPollTimer = null;
  }
  updateTelegramStatus();
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN) return;
  void pollTelegramUpdates();
  telegramPollTimer = window.setInterval(() => { void pollTelegramUpdates(); }, 3500);
}

async function handleSaveTelegram(): Promise<void> {
  const tokenEl = document.querySelector("#telegram-bot-token") as HTMLInputElement;
  const chatIdEl = document.querySelector("#telegram-chat-id") as HTMLInputElement;
  const enabledEl = document.querySelector("#telegram-enabled") as HTMLInputElement;
  TELEGRAM_BOT_TOKEN = tokenEl.value.trim();
  TELEGRAM_CHAT_ID = chatIdEl.value.trim();
  TELEGRAM_ENABLED = enabledEl.checked;
  localStorage.setItem("telegram-bot-token", TELEGRAM_BOT_TOKEN);
  localStorage.setItem("telegram-chat-id", TELEGRAM_CHAT_ID);
  localStorage.setItem("telegram-enabled", String(TELEGRAM_ENABLED));
  restartTelegramPolling();
  showToast(telegramToast, "Telegram settings saved.", "success");

  if (TELEGRAM_ENABLED && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await invoke("telegram_send_message", {
        botToken: TELEGRAM_BOT_TOKEN,
        chatId: TELEGRAM_CHAT_ID,
        message: "CATOG Telegram chat is connected. Send a task or ask me to run a saved workflow.",
      });
      updateTelegramStatus("Telegram chat: Enabled and connected");
    } catch (err) {
      const errText = String(err);
      if (errText.toLowerCase().includes("chat not found")) {
        TELEGRAM_CHAT_ID = "";
        localStorage.setItem("telegram-chat-id", "");
        chatIdEl.value = "";
        restartTelegramPolling();
        updateTelegramStatus("Telegram chat: saved token, waiting for first message to auto-fill Chat ID");
        showToast(telegramToast, "Chat ID was invalid. Send the bot a new message to auto-link.", "error");
      } else {
        updateTelegramStatus(`Telegram test failed: ${errText.substring(0, 120)}`);
        showToast(telegramToast, "Telegram test failed.", "error");
      }
    }
  } else if (TELEGRAM_ENABLED && TELEGRAM_BOT_TOKEN) {
    updateTelegramStatus("Telegram chat: waiting for first message to auto-fill Chat ID");
  }
}

async function handleSaveAi(): Promise<void> {
  const visionUrlEl = document.querySelector("#ai-vision-url") as HTMLInputElement;
  const coderUrlEl = document.querySelector("#ai-coder-url") as HTMLInputElement;
  const visionModelEl = document.querySelector("#ai-vision-model") as HTMLInputElement;
  const coderModelEl = document.querySelector("#ai-coder-model") as HTMLInputElement;
  const visionUrl = visionUrlEl.value.trim();
  const coderUrl = coderUrlEl.value.trim();
  const userVisionModel = visionModelEl.value.trim();
  const userCoderModel = coderModelEl.value.trim();
  if (!visionUrl || !coderUrl) { alert("Both URLs are required."); return; }
  AI_VISION_URL = visionUrl;
  AI_CODER_URL = coderUrl;
  localStorage.setItem("ai-vision-url", visionUrl);
  localStorage.setItem("ai-coder-url", coderUrl);

  const statusEl = document.querySelector("#ai-status") as HTMLDivElement;
  statusEl.innerHTML = "⏳ Testing connections...";
  let coderStatus = "";
  let visionStatus = "";
  let finalCoderModel = userCoderModel;
  let finalVisionModel = userVisionModel;
  // Reset module-level detected models for this test
  let localDetectedCoderModel = "";
  let localDetectedVisionModel = "";

  try {
    const res = await fetch(`${coderUrl}/v1/models`);
    const data = await res.json();
    localDetectedCoderModel = data.data?.[0]?.id || "";
    let chatTest = "";
    const preferredCoderModel = (!userCoderModel || isBuiltInDefaultModel(userCoderModel, "coder"))
      ? localDetectedCoderModel || userCoderModel || DEFAULT_CODER_MODEL
      : userCoderModel;
    try {
      const chatRes = await fetch(`${coderUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: preferredCoderModel, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      });
      if (chatRes.ok) {
        finalCoderModel = preferredCoderModel;
        chatTest = " ✅chat";
      } else if (localDetectedCoderModel && localDetectedCoderModel !== preferredCoderModel) {
        const retryRes = await fetch(`${coderUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: localDetectedCoderModel, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        });
        finalCoderModel = retryRes.ok ? localDetectedCoderModel : preferredCoderModel;
        chatTest = retryRes.ok ? " ✅chat(auto-detected)" : ` ❌chat(${chatRes.status})`;
      } else {
        finalCoderModel = preferredCoderModel;
        chatTest = ` ❌chat(${chatRes.status})`;
      }
    } catch { chatTest = " ❌chat(err)"; }
    coderStatus = `✅ Coder: ${localDetectedCoderModel || "unknown"}${chatTest}`;
  } catch {
    coderStatus = `❌ Coder unreachable at ${coderUrl}`;
  }
  try {
    const res = await fetch(`${visionUrl}/v1/models`);
    const data = await res.json();
    localDetectedVisionModel = data.data?.[0]?.id || "";
    let chatTest = "";
    let visionImgTest = "";
    // Test with a tiny 1x1 white PNG (base64) to verify image input support
    const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    let testVisionModel = (!userVisionModel || isBuiltInDefaultModel(userVisionModel, "vision"))
      ? localDetectedVisionModel || userVisionModel || DEFAULT_VISION_MODEL
      : userVisionModel;
    try {
      const testVisionChat = (model: string) => fetch(`${visionUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${tinyPngBase64}` } },
          ] }],
          max_tokens: 1,
        }),
      });
      let chatRes = await testVisionChat(testVisionModel);
      if (!chatRes.ok && localDetectedVisionModel && localDetectedVisionModel !== testVisionModel) {
        const retryRes = await testVisionChat(localDetectedVisionModel);
        if (retryRes.ok) {
          testVisionModel = localDetectedVisionModel;
          chatRes = retryRes;
        }
      }
      if (chatRes.ok) {
        finalVisionModel = testVisionModel;
        chatTest = " ✅chat";
        visionImgTest = " ✅image";
      } else {
        const errBody = await chatRes.text().catch(() => "");
        finalVisionModel = testVisionModel;
        chatTest = ` ❌chat(${chatRes.status})`;
        // Check if the error mentions image support
        if (errBody.includes("does not support image") || errBody.includes("image input")) {
          visionImgTest = ` ❌image(not supported — model "${testVisionModel}" may not be a vision model)`;
        } else {
          visionImgTest = ` ❌image(${chatRes.status})`;
        }
      }
    } catch { chatTest = " ❌chat(err)"; visionImgTest = " ❌image(err)"; }
    visionStatus = `✅ Vision: ${localDetectedVisionModel || "unknown"}${chatTest}${visionImgTest}`;
  } catch {
    visionStatus = `❌ Vision unreachable at ${visionUrl}`;
  }

  // Update module-level detected models (used by getCoderModel/getVisionModel as fallback)
  detectedCoderModel = localDetectedCoderModel;
  detectedVisionModel = localDetectedVisionModel;

  // Resolve final model names: validated typed model > detected server model > hardcoded emergency fallback.
  finalCoderModel = finalCoderModel || localDetectedCoderModel || DEFAULT_CODER_MODEL;
  finalVisionModel = finalVisionModel || localDetectedVisionModel || DEFAULT_VISION_MODEL;

  // Always persist the final model names to localStorage and update input fields
  localStorage.setItem("ai-coder-model", finalCoderModel);
  localStorage.setItem("ai-vision-model", finalVisionModel);
  coderModelEl.value = finalCoderModel;
  visionModelEl.value = finalVisionModel;

  const usingLine = `<small>Using: coder=${finalCoderModel} | vision=${finalVisionModel}</small>`;
  statusEl.innerHTML = `${coderStatus}<br>${visionStatus}<br>${usingLine}`;
  appendMessage("assistant", "AI configuration updated.");
}

// ── Skill Import/Export ──
interface CatogFile {
  catogVersion: number;
  type: "skill" | "aiz-workflow";
  skill?: {
    id: string;
    name: string;
    prompt: string;
    createdAt: string;
  };
  workflow?: AizWorkflowRecord;
}

function toCatogFile(skill: Skill): CatogFile {
  if (skill.kind === "aiz-workflow" && skill.workflowId) {
    const workflow = savedAizWorkflows.find((w) => w.id === skill.workflowId);
    if (workflow) {
      return { catogVersion: 1, type: "aiz-workflow", workflow };
    }
  }
  return { catogVersion: 1, type: "skill", skill };
}

function updateImportPreview(file: File): void {
  currentImportFile = file;
  importPreviewName.textContent = file.name;
  importPreviewSize.textContent = formatBytes(file.size);
  importFormatBadge.textContent = ".catog";
  importFilePreview.classList.remove("hidden");
}
function clearImportPreview(): void {
  currentImportFile = null;
  importFilePreview.classList.add("hidden");
  importSkillFile.value = "";
  importSkillName.value = "";
}
function handleImportSkill(): void {
  if (!currentImportFile) { showToast(importToast, "Please select a .catog file first", "error"); return; }
  const ext = getFileExtension(currentImportFile.name);
  if (ext !== "catog") { showToast(importToast, "Only .catog files are supported", "error"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const content = reader.result as string;
      const parsed = JSON.parse(content) as CatogFile;
      if (parsed.catogVersion !== 1) {
        showToast(importToast, "Invalid .catog file format", "error");
        return;
      }
      if (parsed.type === "aiz-workflow" && parsed.workflow) {
        const wf = parsed.workflow;
        const importedName = importSkillName.value.trim() || wf.name;
        const existing = savedAizWorkflows.find((w) => w.id === wf.id || w.name.toLowerCase() === importedName.toLowerCase());
        const workflowRecord: AizWorkflowRecord = {
          ...wf,
          name: importedName,
          updatedAt: new Date().toISOString(),
        };
        if (existing) {
          Object.assign(existing, workflowRecord);
        } else {
          savedAizWorkflows.unshift(workflowRecord);
        }
        saveAizWorkflows();
        upsertAizWorkflowSkill(workflowRecord);
        renderSkills();
        showToast(importToast, `Aiz workflow "${importedName}" imported!`, "success");
      } else if (parsed.type === "skill" && parsed.skill) {
        const name = importSkillName.value.trim() || parsed.skill.name;
        saveSkill(name, parsed.skill.prompt);
        showToast(importToast, `Skill "${name}" imported!`, "success");
      } else {
        showToast(importToast, "Invalid .catog file format", "error");
        return;
      }
    } catch {
      showToast(importToast, "Failed to parse .catog file", "error");
      return;
    }
    clearImportPreview();
    closeWidgetFn(importSkillWidget);
  };
  reader.onerror = () => showToast(importToast, "Failed to read file", "error");
  reader.readAsText(currentImportFile);
}

function populateExportSkillSelect(): void {
  if (!exportSkillSelect) return;
  exportSkillSelect.innerHTML = '<option value="">-- Select a skill --</option>';
  for (const skill of savedSkills) {
    const opt = document.createElement("option");
    opt.value = skill.id;
    opt.textContent = skill.name;
    exportSkillSelect.appendChild(opt);
  }
}

function generateCatogPreview(skillId: string): string {
  const skill = savedSkills.find((s) => s.id === skillId);
  if (!skill) return "Select a skill to preview";
  return JSON.stringify(toCatogFile(skill), null, 2);
}
function updateExportPreview(): void {
  const skillId = exportSkillSelect.value;
  if (!skillId) { exportPreview.classList.add("hidden"); return; }
  exportPreviewCode.textContent = generateCatogPreview(skillId);
  exportPreview.classList.remove("hidden");
}
function handleExportSkill(): void {
  const skillId = exportSkillSelect.value;
  if (!skillId) { showToast(exportToast, "Please select a skill to export", "error"); return; }
  const skill = savedSkills.find((s) => s.id === skillId);
  if (!skill) { showToast(exportToast, "Skill not found", "error"); return; }
  const catogData = toCatogFile(skill);
  const content = JSON.stringify(catogData, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${skill.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.catog`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(exportToast, `Exported ${skill.name}.catog!`, "success");
  closeWidgetFn(exportSkillWidget);
}

// ── Explore Tool UI helpers ──
let exploreCachedApps: { name: string; sub?: string }[] = [];

async function primeExploreProgramList(): Promise<void> {
  if (exploreCachedApps.length > 0) {
    renderExploreProgramListFiltered("");
    return;
  }
  try {
    const installed = await invoke<InstalledApplication[]>("get_installed_applications").catch(() => null);
    if (installed && installed.length > 0) {
      exploreCachedApps = installed.map((a) => ({ name: a.name }));
    } else {
      const running = await invoke<RunningProgram[]>("get_running_programs");
      exploreCachedApps = running.map((p) => ({
        name: p.name,
        sub: p.title && p.title !== p.name ? p.title : undefined,
      }));
    }
  } catch {
    exploreCachedApps = [];
  }
  renderExploreProgramListFiltered("");
}

function renderExploreProgramListFiltered(query: string): void {
  const listEl = document.getElementById("explore-program-list") as HTMLDivElement | null;
  if (!listEl) return;
  const q = query.trim().toLowerCase();
  const items = q
    ? exploreCachedApps.filter((a) => a.name.toLowerCase().includes(q) || (a.sub && a.sub.toLowerCase().includes(q)))
    : exploreCachedApps.slice(0, 30);
  listEl.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "aiz-program-empty";
    empty.textContent = exploreCachedApps.length === 0 ? "Loading programs…" : "No matches";
    listEl.appendChild(empty);
    return;
  }
  for (const app of items) {
    const item = document.createElement("div");
    item.className = "aiz-program-item";
    item.dataset.name = app.name;
    const name = document.createElement("div");
    name.className = "aiz-program-item-name";
    name.textContent = app.name;
    item.appendChild(name);
    if (app.sub) {
      const sub = document.createElement("div");
      sub.className = "aiz-program-item-sub";
      sub.textContent = app.sub;
      item.appendChild(sub);
    }
    item.addEventListener("click", () => {
      const input = document.getElementById("explore-program-input") as HTMLInputElement | null;
      if (input) input.value = app.name;
      // visually mark
      listEl.querySelectorAll(".aiz-program-item").forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");
    });
    listEl.appendChild(item);
  }
}

function renderExploreProfilesList(): void {
  const listEl = document.getElementById("explore-profiles-list");
  if (!listEl) return;
  const store = exploreLoadProfiles();
  const profiles = Object.values(store.profiles);
  listEl.innerHTML = "";
  if (profiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explore-profiles-empty";
    empty.textContent = "No saved profiles yet. Pick a program above and click Start Self-Learning.";
    listEl.appendChild(empty);
    return;
  }
  profiles.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const p of profiles) {
    const row = document.createElement("div");
    row.className = "explore-profile-item";
    const info = document.createElement("div");
    info.className = "explore-profile-info";
    const name = document.createElement("div");
    name.className = "explore-profile-name";
    name.textContent = p.programName;
    const meta = document.createElement("div");
    meta.className = "explore-profile-meta";
    const when = new Date(p.updatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    meta.textContent = `${p.tools.length} controls · ${p.iterations} iterations · ${when}`;
    info.appendChild(name);
    info.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "explore-profile-actions";
    const reExploreBtn = document.createElement("button");
    reExploreBtn.textContent = "Re-explore";
    reExploreBtn.addEventListener("click", () => {
      const input = document.getElementById("explore-program-input") as HTMLInputElement | null;
      if (input) input.value = p.programName;
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      exploreDeleteProfile(p.programName);
      renderExploreProfilesList();
    });
    actions.appendChild(reExploreBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

function exploreLogAppend(msg: string, kind: "info" | "tool" | "iter" | "warn" | "done" = "info"): void {
  const logEl = document.getElementById("explore-log");
  if (!logEl) return;
  const entry = document.createElement("div");
  entry.className = `explore-entry ${kind}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.textContent = `[${time}] ${msg}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 200) logEl.removeChild(logEl.children[0]);
}

function exploreSetStatusUI(text: string, toolsCount: number, iter: number): void {
  const statusBox = document.getElementById("explore-status");
  if (statusBox) statusBox.removeAttribute("hidden");
  const statusText = document.getElementById("explore-status-text");
  if (statusText) statusText.textContent = text;
  const toolsEl = document.getElementById("explore-stat-tools");
  if (toolsEl) toolsEl.textContent = String(toolsCount);
  const iterEl = document.getElementById("explore-stat-iter");
  if (iterEl) iterEl.textContent = String(iter);
}

async function handleExploreStart(): Promise<void> {
  if (exploreRunning) {
    exploreLogAppend("Exploration already running.", "warn");
    return;
  }
  const input = document.getElementById("explore-program-input") as HTMLInputElement | null;
  const iterInput = document.getElementById("explore-iterations") as HTMLInputElement | null;
  const startBtn = document.getElementById("explore-start-btn") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("explore-stop-btn") as HTMLButtonElement | null;

  const programName = (input?.value || "").trim();
  if (!programName) {
    exploreLogAppend("Pick a program first.", "warn");
    return;
  }
  const iterations = Math.max(5, Math.min(60, Number(iterInput?.value) || 20));

  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.hidden = false;
  exploreSetStatusUI(`Exploring "${programName}"…`, 0, 0);
  exploreLogAppend(`Self-Learning started for "${programName}" (${iterations} iterations max).`, "info");

  try {
    const profile = await runProgramExploration({
      programName,
      iterations,
      onLog: (msg, kind) => exploreLogAppend(msg, kind),
      onStat: (t, i) => exploreSetStatusUI(`Exploring "${programName}"…`, t, i),
    });
    exploreSetStatusUI(
      profile.tools.length > 0 ? "Done — profile saved" : "Done — nothing learned",
      profile.tools.length,
      profile.iterations,
    );
    renderExploreProfilesList();
  } catch (e) {
    exploreLogAppend(`Exploration failed: ${String(e)}`, "warn");
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.hidden = true;
    exploreRunning = false;
    exploreStopFlag = false;
  }
}

// ── Terminal ──
export function enterTerminalMode(): void {
  appShellEl.classList.add("terminal-mode");
  if (terminal && fitAddon) { setTimeout(() => { fitAddon!.fit(); terminal!.focus(); }, 350); }
}
function exitTerminalMode(): void {
  appShellEl.classList.remove("terminal-mode");
  if (fitAddon) { setTimeout(() => { fitAddon!.fit(); }, 350); }
}
function setupTerminal(): void {
  terminal = new Terminal({
    cursorBlink: true, fontSize: 13,
    fontFamily: 'var(--font-mono), "JetBrains Mono", monospace',
    theme: { background: "#000000", foreground: "#ffffff", cursor: "#3b82f6", selectionBackground: "rgba(59, 130, 246, 0.3)" },
    convertEol: true, scrollback: 1000,
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalContainer);
  fitAddon.fit();
  terminal.onData((data) => { void invoke("terminal_input", { input: data }); });
  void listen("terminal-output", (event: { payload: string }) => { terminal?.write(event.payload); });
  window.addEventListener("resize", () => { fitAddon?.fit(); });
}

// ── Aiz Skill Builder ──
function setupAizSkillBuilder(): void {
  const canvas = document.getElementById("aiz-canvas") as HTMLDivElement;
  const tabNodes = document.getElementById("aiz-palette-tab-nodes") as HTMLButtonElement;
  const tabWorkflows = document.getElementById("aiz-palette-tab-workflows") as HTMLButtonElement;
  const nodesPanel = document.getElementById("aiz-palette-nodes-panel") as HTMLDivElement;
  const workflowsPanel = document.getElementById("aiz-palette-workflows-panel") as HTMLDivElement;
  const connectorsSvg = document.getElementById("aiz-connectors") as unknown as SVGSVGElement;
  const configPanel = document.getElementById("aiz-config-panel") as HTMLDivElement;
  const configBody = document.getElementById("aiz-config-body") as HTMLDivElement;
  const configTitle = document.getElementById("aiz-config-title") as HTMLSpanElement;
  const configClose = document.getElementById("aiz-config-close") as HTMLButtonElement;
  const btnRun = document.getElementById("aiz-run") as HTMLButtonElement;
  const btnClear = document.getElementById("aiz-clear") as HTMLButtonElement;
  const btnSave = document.getElementById("aiz-save-workflow") as HTMLButtonElement;
  const workflowSelect = document.getElementById("aiz-workflow-select") as HTMLSelectElement;
  const canvasHint = document.getElementById("aiz-canvas-hint") as HTMLDivElement;
  aizOutputEl = document.getElementById("aiz-node-output") as HTMLDivElement;

  const runModeSelect = document.getElementById("aiz-run-mode") as HTMLSelectElement;
  const runCountInput = document.getElementById("aiz-run-count") as HTMLInputElement;
  const btnStop = document.getElementById("aiz-stop") as HTMLButtonElement;

  let nodeIdCounter = 0;
  const PROXIMITY_THRESHOLD = 60;

  function generateId(): string {
    return "node_" + (++nodeIdCounter) + "_" + Date.now();
  }

  function getNodeIcon(type: string): string {
    if (type === "program") return "📱";
    if (type === "prompt") return "💬";
    if (type === "save") return "💾";
    const custom = customNodeTypes.find((c) => c.id === type);
    return custom ? custom.icon : "⚙️";
  }

  function getNodeColor(type: string): string {
    if (type === "program") return "#3b82f6";
    if (type === "prompt") return "#10b981";
    if (type === "save") return "#f59e0b";
    const custom = customNodeTypes.find((c) => c.id === type);
    return custom ? custom.color : "#60a5fa";
  }

  function getCanvasRect(): DOMRect {
    return canvas.getBoundingClientRect();
  }

  function setPaletteTab(tab: "nodes" | "workflows"): void {
    const showNodes = tab === "nodes";
    tabNodes.classList.toggle("active", showNodes);
    tabWorkflows.classList.toggle("active", !showNodes);
    nodesPanel.classList.toggle("hidden", !showNodes);
    workflowsPanel.classList.toggle("hidden", showNodes);
  }

  tabNodes.addEventListener("click", () => setPaletteTab("nodes"));
  tabWorkflows.addEventListener("click", () => setPaletteTab("workflows"));

  function getRelativeCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = getCanvasRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function getStartNodes(): string[] {
    const incoming = new Set(aizConnections.map((c) => c.toId));
    return aizNodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  }

  function renderConnections(): void {
    while (connectorsSvg.children.length > 0) {
      connectorsSvg.removeChild(connectorsSvg.children[0]);
    }

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
        <linearGradient id="connGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#a855f7;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="connGradientActive" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#d946ef;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#a855f7;stop-opacity:1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      `;
    connectorsSvg.appendChild(defs);

    for (const conn of aizConnections) {
      const fromNode = aizNodes.find((n) => n.id === conn.fromId);
      const toNode = aizNodes.find((n) => n.id === conn.toId);
      if (!fromNode || !toNode) continue;
      const fromEl = canvas.querySelector(`[data-id="${conn.fromId}"]`) as HTMLElement;
      const toEl = canvas.querySelector(`[data-id="${conn.toId}"]`) as HTMLElement;
      if (!fromEl || !toEl) continue;
      const fromWidth = fromEl.offsetWidth;
      const fromHeight = fromEl.offsetHeight;
      const toHeight = toEl.offsetHeight;
      // Output port = right side of fromNode, Input port = left side of toNode
      const x1 = fromNode.x + fromWidth;
      const y1 = fromNode.y + fromHeight / 2;
      const x2 = toNode.x;
      const y2 = toNode.y + toHeight / 2;
      const dx = Math.abs(x2 - x1) * 0.5 + 20;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      path.setAttribute("stroke", "url(#connGradient)");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("filter", "url(#glow)");
      // Arrow at the end
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const ax = x2 - 8, ay = y2 - 5, bx = x2, by = y2, cx = x2 - 8, cy = y2 + 5;
      arrow.setAttribute("points", `${ax},${ay} ${bx},${by} ${cx},${cy}`);
      arrow.setAttribute("fill", "#3b82f6");
      connectorsSvg.appendChild(path);
      connectorsSvg.appendChild(arrow);
    }

    if (aizPendingConnection) {
      const fromNode = aizNodes.find((n) => n.id === aizPendingConnection!.fromId);
      if (fromNode) {
        const fromEl = canvas.querySelector(`[data-id="${fromNode.id}"]`) as HTMLElement;
        if (fromEl) {
          const x1 = fromNode.x + fromEl.offsetWidth;
          const y1 = fromNode.y + fromEl.offsetHeight / 2;
          const rel = getRelativeCoords(aizPendingConnection.x, aizPendingConnection.y);
          const x2 = rel.x;
          const y2 = rel.y;
          const dx = Math.abs(x2 - x1) * 0.5 + 20;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
          path.setAttribute("stroke", "#d946ef");
          path.setAttribute("stroke-width", "2.5");
          path.setAttribute("stroke-dasharray", "8,4");
          path.setAttribute("fill", "none");
          path.setAttribute("stroke-linecap", "round");
          path.setAttribute("filter", "url(#glow)");
          connectorsSvg.appendChild(path);
        }
      }
    }
  }

  function getNodePreview(node: AizNode): string {
    if (node.type === "program" && node.config.appName) {
      return `<div class="aiz-node-preview-box"><span class="aiz-node-preview-label">Program</span><span class="aiz-node-preview-value">${node.config.appName}</span></div>`;
    }
    if (node.type === "prompt" && node.config.instruction) {
      const text = node.config.instruction.length > 35 ? node.config.instruction.substring(0, 35) + "..." : node.config.instruction;
      return `<div class="aiz-node-preview-box"><span class="aiz-node-preview-label">Instruction</span><span class="aiz-node-preview-value">${text}</span></div>`;
    }
    if (node.type === "save" && node.config.filename) {
      const fmt = node.config.format || "txt";
      return `<div class="aiz-node-preview-box"><span class="aiz-node-preview-label">Save to</span><span class="aiz-node-preview-value">${node.config.filename}.${fmt}</span></div>`;
    }
    const custom = customNodeTypes.find((c) => c.id === node.type);
    if (custom) {
      const firstKey = custom.configFields.length > 0 ? custom.configFields[0].key : null;
      if (firstKey && node.config[firstKey]) {
        const val = node.config[firstKey].length > 35 ? node.config[firstKey].substring(0, 35) + "..." : node.config[firstKey];
        return `<div class="aiz-node-preview-box"><span class="aiz-node-preview-label">${custom.configFields[0].label}</span><span class="aiz-node-preview-value">${val}</span></div>`;
      }
    }
    return `<div class="aiz-node-preview-empty">Click to configure</div>`;
  }

  function renderNodes(): void {
    canvas.querySelectorAll(".aiz-node").forEach((el) => el.remove());
    const startNodeIds = getStartNodes();
    for (const node of aizNodes) {
      const el = createNodeElement(node);
      if (node.id === selectedNodeId) el.classList.add("selected");
      if (startNodeIds.includes(node.id)) el.classList.add("start-node");
      canvas.appendChild(el);
    }
    if (canvasHint) {
      if (aizNodes.length === 0) {
        canvasHint.classList.remove("hidden");
      } else {
        canvasHint.classList.add("hidden");
      }
    }
    renderConnections();
  }

  function createNodeElement(node: AizNode): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `aiz-node aiz-node-type-${node.type}`;
    el.dataset.id = node.id;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    const custom = customNodeTypes.find((c) => c.id === node.type);
    if (custom) {
      el.style.borderColor = custom.color + "40";
    }
    el.innerHTML = `
        <button class="aiz-node-delete" title="Delete node">×</button>
        <div class="aiz-node-header">
          <span class="aiz-node-icon">${getNodeIcon(node.type)}</span>
          <span class="aiz-node-label">${getNodeLabel(node.type)}</span>
        </div>
        <div class="aiz-node-body">${getNodePreview(node)}</div>
        <div class="aiz-node-connector left" data-port="input"></div>
        <div class="aiz-node-connector right" data-port="output"></div>
      `;

    // Delete button handler
    const deleteBtn = el.querySelector(".aiz-node-delete") as HTMLButtonElement;
    deleteBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      aizNodes = aizNodes.filter((n) => n.id !== node.id);
      aizConnections = aizConnections.filter((c) => c.fromId !== node.id && c.toId !== node.id);
      if (selectedNodeId === node.id) {
        selectedNodeId = null;
        configPanel.classList.add("hidden");
      }
      renderNodes();
    });

    const header = el.querySelector(".aiz-node-header") as HTMLElement;
    if (custom) {
      header.style.background = `linear-gradient(135deg, ${custom.color}30 0%, ${custom.color}10 100%)`;
    }
    header.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedNodeId = node.id;
      aizDragNode = node;
      const rel = getRelativeCoords(e.clientX, e.clientY);
      aizDragOffset = { x: rel.x - node.x, y: rel.y - node.y };
      renderNodes();
    });

    // Click body to configure
    const body = el.querySelector(".aiz-node-body") as HTMLElement;
    body.addEventListener("click", (e) => {
      e.stopPropagation();
      showConfigPanel(node);
    });

    // Output port drag starts connection
    const outputPort = el.querySelector(".aiz-node-connector.right") as HTMLElement;
    outputPort.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      aizPendingConnection = { fromId: node.id, x: e.clientX, y: e.clientY };
    });

    // Input port: complete connection on mouseup
    const inputPort = el.querySelector(".aiz-node-connector.left") as HTMLElement;
    inputPort.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      if (aizPendingConnection && aizPendingConnection.fromId !== node.id) {
        const existing = aizConnections.find((c) => c.fromId === aizPendingConnection!.fromId && c.toId === node.id);
        if (!existing) {
          aizConnections.push({ id: "conn_" + Date.now(), fromId: aizPendingConnection.fromId, toId: node.id });
          renderConnections();
        }
      }
      aizPendingConnection = null;
      renderConnections();
    });

    return el;
  }

  function showConfigPanel(node: AizNode): void {
    selectedNodeId = node.id;
    renderNodes();
    configPanel.classList.remove("hidden");
    configTitle.textContent = getNodeLabel(node.type) + " Node";
    configBody.innerHTML = "";

    if (node.type === "program") {
      // Program selector with live preview + searchable list
      const previewDiv = document.createElement("div");
      previewDiv.className = "aiz-config-preview";
      previewDiv.innerHTML = `<div class="aiz-config-preview-icon">📱</div><div class="aiz-config-preview-text">${node.config.appName || "No program selected"}</div>`;
      if (node.config.appName) previewDiv.classList.add("active");
      configBody.appendChild(previewDiv);

      const appGroup = document.createElement("div");
      appGroup.className = "form-group aiz-program-picker";
      appGroup.innerHTML = `
        <label>Select Program</label>
        <input type="search" id="aiz-config-app-search" class="aiz-program-search" placeholder="Search installed programs..." autocomplete="off" spellcheck="false" />
        <div id="aiz-config-app-list" class="aiz-program-list" role="listbox" aria-label="Installed programs">
          <div class="aiz-program-empty">Loading installed programs...</div>
        </div>
        <div id="aiz-config-app-count" class="aiz-program-count"></div>
      `;
      configBody.appendChild(appGroup);

      const searchEl = document.getElementById("aiz-config-app-search") as HTMLInputElement;
      const listEl = document.getElementById("aiz-config-app-list") as HTMLDivElement;
      const countEl = document.getElementById("aiz-config-app-count") as HTMLDivElement;

      let allApps: { name: string; sub?: string }[] = [];

      const selectApp = (name: string) => {
        node.config.appName = name;
        const previewText = previewDiv.querySelector(".aiz-config-preview-text")!;
        previewText.textContent = name || "No program selected";
        previewDiv.classList.toggle("active", !!name);
        saveNodeConfig(node);
        // Update visual selection
        listEl.querySelectorAll(".aiz-program-item").forEach((el) => {
          el.classList.toggle("selected", (el as HTMLElement).dataset.name === name);
        });
      };

      const renderList = (filter: string) => {
        const q = filter.trim().toLowerCase();
        const filtered = q
          ? allApps.filter((a) => a.name.toLowerCase().includes(q) || (a.sub || "").toLowerCase().includes(q))
          : allApps;

        listEl.innerHTML = "";
        if (filtered.length === 0) {
          listEl.innerHTML = `<div class="aiz-program-empty">${allApps.length === 0 ? "No applications found" : "No matches"}</div>`;
          countEl.textContent = allApps.length === 0 ? "" : `0 of ${allApps.length}`;
          return;
        }
        const frag = document.createDocumentFragment();
        for (const app of filtered) {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "aiz-program-item";
          item.dataset.name = app.name;
          item.setAttribute("role", "option");
          if (node.config.appName === app.name) item.classList.add("selected");
          const subHtml = app.sub ? `<span class="aiz-program-item-sub">${app.sub}</span>` : "";
          item.innerHTML = `<span class="aiz-program-item-name"></span>${subHtml}`;
          (item.querySelector(".aiz-program-item-name") as HTMLElement).textContent = app.name;
          item.addEventListener("click", () => selectApp(app.name));
          frag.appendChild(item);
        }
        listEl.appendChild(frag);
        countEl.textContent = q
          ? `${filtered.length} of ${allApps.length}`
          : `${allApps.length} program${allApps.length === 1 ? "" : "s"}`;
      };

      const loadFromRunning = () =>
        invoke<RunningProgram[]>("get_running_programs").then((programs) => {
          allApps = programs.map((p) => ({
            name: p.name,
            sub: p.title && p.title !== p.name ? p.title : undefined,
          }));
          renderList(searchEl.value);
        });

      void invoke<InstalledApplication[]>("get_installed_applications")
        .then((apps) => {
          if (!apps || apps.length === 0) return loadFromRunning();
          allApps = apps.map((a) => ({ name: a.name }));
          renderList("");
        })
        .catch(() => {
          listEl.innerHTML = '<div class="aiz-program-empty">Failed to load applications</div>';
        });

      searchEl.addEventListener("input", () => renderList(searchEl.value));
      searchEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const first = listEl.querySelector(".aiz-program-item") as HTMLElement | null;
          if (first?.dataset.name) selectApp(first.dataset.name);
        }
      });

      const delayGroup = document.createElement("div");
      delayGroup.className = "form-group";
      delayGroup.innerHTML = `<label>Launch Delay (ms)</label><input type="number" id="aiz-config-delay" value="${node.config.delay || "1000"}" min="0" step="100" />`;
      configBody.appendChild(delayGroup);
      delayGroup.querySelector("input")!.addEventListener("change", () => {
        node.config.delay = (document.getElementById("aiz-config-delay") as HTMLInputElement).value;
        saveNodeConfig(node);
      });

    } else if (node.type === "prompt") {
      // Prompt instruction editor
      const previewDiv = document.createElement("div");
      previewDiv.className = "aiz-config-preview";
      const previewText = node.config.instruction ? (node.config.instruction.length > 40 ? node.config.instruction.substring(0, 40) + "..." : node.config.instruction) : "No instruction set";
      previewDiv.innerHTML = `<div class="aiz-config-preview-icon">💬</div><div class="aiz-config-preview-text">${previewText}</div>`;
      configBody.appendChild(previewDiv);

      const instrGroup = document.createElement("div");
      instrGroup.className = "form-group";
      instrGroup.innerHTML = `<label>AI Instruction / Guidance</label><textarea id="aiz-config-instruction" rows="6" placeholder="Describe what the AI should do...&#10;Example: Open Chrome and search for the latest news&#10;Example: Click the submit button after filling the form">${node.config.instruction || ""}</textarea>`;
      configBody.appendChild(instrGroup);

      const textarea = instrGroup.querySelector("textarea")!;
      textarea.addEventListener("input", () => {
        node.config.instruction = textarea.value;
        const pt = previewDiv.querySelector(".aiz-config-preview-text")!;
        pt.textContent = textarea.value ? (textarea.value.length > 40 ? textarea.value.substring(0, 40) + "..." : textarea.value) : "No instruction set";
        if (textarea.value) {
          previewDiv.classList.add("active");
        } else {
          previewDiv.classList.remove("active");
        }
        saveNodeConfig(node);
      });

      // Force the agent mode to "text" — this is the coder-driven path that
      // also calls the vision model when the coder asks for a screenshot, and
      // is the only mode we expose in the UI now (labeled "Vision + Coder").
      // Legacy saved values are normalized to "text" so old skills keep working.
      node.config.visionMode = "text";
      saveNodeConfig(node);

      const visionGroup = document.createElement("div");
      visionGroup.className = "form-group";
      visionGroup.innerHTML = `
        <label>Agent Mode</label>
        <select id="aiz-config-vision-mode">
          <option value="text" selected>Vision + Coder</option>
        </select>
        <p class="aiz-config-hint">
          <strong>Vision + Coder</strong> uses the coder model to plan each step and the vision model to read the screen when a screenshot is taken.
        </p>
      `;
      configBody.appendChild(visionGroup);

    } else if (node.type === "save") {
      // Save file config
      const previewDiv = document.createElement("div");
      previewDiv.className = "aiz-config-preview";
      const filename = node.config.filename || "output";
      const format = node.config.format || "txt";
      previewDiv.innerHTML = `<div class="aiz-config-preview-icon">💾</div><div class="aiz-config-preview-text">${filename}.${format}</div>`;
      configBody.appendChild(previewDiv);

      const fnGroup = document.createElement("div");
      fnGroup.className = "form-group";
      fnGroup.innerHTML = `<label>Filename</label><input type="text" id="aiz-config-filename" value="${node.config.filename || ""}" placeholder="my-results" />`;
      configBody.appendChild(fnGroup);

      const pathGroup = document.createElement("div");
      pathGroup.className = "form-group";
      pathGroup.innerHTML = `<label>Save Location (optional)</label><div class="aiz-path-picker"><input type="text" id="aiz-config-path" value="${node.config.path || ""}" placeholder="Documents folder by default" /><button type="button" id="aiz-config-path-select" title="Select save location">Select...</button></div>`;
      configBody.appendChild(pathGroup);

      const fmtGroup = document.createElement("div");
      fmtGroup.className = "form-group";
      fmtGroup.innerHTML = `<label>File Format</label><select id="aiz-config-format"><option value="txt" ${node.config.format === "txt" ? "selected" : ""}>Text (.txt)</option><option value="json" ${node.config.format === "json" ? "selected" : ""}>JSON (.json)</option><option value="csv" ${node.config.format === "csv" ? "selected" : ""}>CSV (.csv)</option><option value="md" ${node.config.format === "md" ? "selected" : ""}>Markdown (.md)</option></select>`;
      configBody.appendChild(fmtGroup);

      function updateSavePreview(): void {
        const fn = (document.getElementById("aiz-config-filename") as HTMLInputElement).value || "output";
        const fmt = (document.getElementById("aiz-config-format") as HTMLSelectElement).value;
        const pt = previewDiv.querySelector(".aiz-config-preview-text")!;
        pt.textContent = `${fn}.${fmt}`;
        if (fn) {
          previewDiv.classList.add("active");
        } else {
          previewDiv.classList.remove("active");
        }
      }

      fnGroup.querySelector("input")!.addEventListener("input", () => {
        node.config.filename = (document.getElementById("aiz-config-filename") as HTMLInputElement).value;
        updateSavePreview();
        saveNodeConfig(node);
      });
      pathGroup.querySelector("input")!.addEventListener("change", () => {
        node.config.path = (document.getElementById("aiz-config-path") as HTMLInputElement).value;
        saveNodeConfig(node);
      });
      pathGroup.querySelector("#aiz-config-path-select")!.addEventListener("click", async () => {
        const pathInput = document.getElementById("aiz-config-path") as HTMLInputElement;
        try {
          const selectedPath = await invoke<string | null>("select_folder");
          if (!selectedPath) return;
          pathInput.value = selectedPath;
          node.config.path = selectedPath;
          saveNodeConfig(node);
        } catch (err) {
          pathInput.placeholder = `Folder picker unavailable: ${String(err).substring(0, 60)}`;
          pathInput.focus();
        }
      });
      fmtGroup.querySelector("select")!.addEventListener("change", () => {
        node.config.format = (document.getElementById("aiz-config-format") as HTMLSelectElement).value;
        updateSavePreview();
        saveNodeConfig(node);
      });
    } else {
      const customDef = customNodeTypes.find((c) => c.id === node.type);
      if (customDef) {
        const previewDiv = document.createElement("div");
        previewDiv.className = "aiz-config-preview";
        previewDiv.innerHTML = `<div class="aiz-config-preview-icon">${customDef.icon}</div><div class="aiz-config-preview-text">${customDef.description}</div>`;
        configBody.appendChild(previewDiv);

        const customFields = isFileFolderOpenerCustomNode(customDef)
          ? customDef.configFields.filter((field) => field.key.toLowerCase() !== "destination")
          : customDef.configFields;
        if (isFileFolderOpenerCustomNode(customDef) && "destination" in node.config) {
          delete node.config.destination;
          saveNodeConfig(node);
        }

        for (const field of customFields) {
          const group = document.createElement("div");
          group.className = "form-group";
          if (field.type === "textarea") {
            group.innerHTML = `<label>${field.label}</label><textarea id="aiz-ccfg-${field.key}" rows="4" placeholder="${field.placeholder || ""}">${node.config[field.key] || ""}</textarea>`;
          } else if (field.type === "select" && field.options) {
            const opts = field.options.map((o) => `<option value="${o}" ${node.config[field.key] === o ? "selected" : ""}>${o}</option>`).join("");
            group.innerHTML = `<label>${field.label}</label><select id="aiz-ccfg-${field.key}">${opts}</select>`;
          } else if (field.type === "number") {
            group.innerHTML = `<label>${field.label}</label><input type="number" id="aiz-ccfg-${field.key}" value="${node.config[field.key] || ""}" placeholder="${field.placeholder || ""}" />`;
          } else if (isPathPickerField(field)) {
            group.innerHTML = `<label>${field.label}</label><div class="aiz-path-picker aiz-path-picker-wide"><input type="text" id="aiz-ccfg-${field.key}" value="${node.config[field.key] || ""}" placeholder="${field.placeholder || "Select or enter file/folder path"}" /><button type="button" data-path-mode="file" title="Select file">File...</button><button type="button" data-path-mode="folder" title="Select folder">Folder...</button></div>`;
          } else {
            group.innerHTML = `<label>${field.label}</label><input type="text" id="aiz-ccfg-${field.key}" value="${node.config[field.key] || ""}" placeholder="${field.placeholder || ""}" />`;
          }
          configBody.appendChild(group);

          const input = group.querySelector("input, textarea, select") as HTMLElement;
          input.addEventListener("input", () => {
            node.config[field.key] = (input as HTMLInputElement).value;
            saveNodeConfig(node);
          });
          input.addEventListener("change", () => {
            node.config[field.key] = (input as HTMLInputElement).value;
            saveNodeConfig(node);
          });
          group.querySelectorAll("[data-path-mode]").forEach((button) => {
            button.addEventListener("click", async () => {
              try {
                await selectCustomPath(input as HTMLInputElement, (button as HTMLElement).dataset.pathMode === "file" ? "file" : "folder");
              } catch (err) {
                (input as HTMLInputElement).placeholder = `Picker unavailable: ${String(err).substring(0, 60)}`;
                input.focus();
              }
            });
          });
        }
      }
    }

    const delBtn = document.createElement("button");
    delBtn.className = "widget-save";
    delBtn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    delBtn.style.marginTop = "16px";
    delBtn.textContent = "🗑 Delete Node";
    delBtn.addEventListener("click", () => {
      aizNodes = aizNodes.filter((n) => n.id !== node.id);
      aizConnections = aizConnections.filter((c) => c.fromId !== node.id && c.toId !== node.id);
      configPanel.classList.add("hidden");
      selectedNodeId = null;
      renderNodes();
    });
    configBody.appendChild(delBtn);
  }

  function saveNodeConfig(node: AizNode): void {
    const el = canvas.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
    if (el) {
      const body = el.querySelector(".aiz-node-body");
      if (body) body.innerHTML = getNodePreview(node);
    }
    renderConnections();
    syncWorkflowSelect();
  }

  configClose.addEventListener("click", () => {
    configPanel.classList.add("hidden");
    selectedNodeId = null;
    renderNodes();
  });

  let aizPaletteGhost: HTMLElement | null = null;

  document.addEventListener("mousedown", (e: MouseEvent) => {
    const paletteEl = document.getElementById("aiz-palette");
    const target = (e.target as HTMLElement).closest(".aiz-node-type") as HTMLElement | null;
    if (!target) return;
    if (!paletteEl?.contains(target)) return;
    if ((e.target as HTMLElement).closest(".aiz-node-type-delete")) return;
    e.preventDefault();
    const nodeType = target.dataset.type!;
    aizDragType = nodeType;

    aizPaletteGhost = document.createElement("div");
    aizPaletteGhost.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 99999;
      opacity: 0.8;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: ${getNodeColor(nodeType)};
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.1s;
    `;
    aizPaletteGhost.textContent = getNodeIcon(nodeType) + " " + getNodeLabel(nodeType);
    aizPaletteGhost.style.left = e.clientX - 40 + "px";
    aizPaletteGhost.style.top = e.clientY - 16 + "px";
    document.body.appendChild(aizPaletteGhost);
  });

  document.addEventListener("mousemove", (e) => {
    if (aizPaletteGhost && aizDragType && !aizDragNode) {
      aizPaletteGhost.style.opacity = "0.8";
      aizPaletteGhost.style.left = e.clientX - 40 + "px";
      aizPaletteGhost.style.top = e.clientY - 16 + "px";
      const cRect = canvas.getBoundingClientRect();
      const overCanvas =
        e.clientX >= cRect.left && e.clientX <= cRect.right &&
        e.clientY >= cRect.top && e.clientY <= cRect.bottom;
      canvas.classList.toggle("drag-over", overCanvas);
      return;
    }
    if (!aizDragNode) return;
    const rel = getRelativeCoords(e.clientX, e.clientY);
    aizDragNode.x = rel.x - aizDragOffset.x;
    aizDragNode.y = rel.y - aizDragOffset.y;
    if (aizPendingConnection) {
      aizPendingConnection.x = e.clientX;
      aizPendingConnection.y = e.clientY;
    }
    renderNodes();
  });

  document.addEventListener("mouseup", (e) => {
    if (aizPaletteGhost && aizDragType && !aizDragNode) {
      const cRect = canvas.getBoundingClientRect();
      const overCanvas =
        e.clientX >= cRect.left && e.clientX <= cRect.right &&
        e.clientY >= cRect.top && e.clientY <= cRect.bottom;
      if (overCanvas) {
        const rel = getRelativeCoords(e.clientX, e.clientY);
        const newNode: AizNode = { id: generateId(), type: aizDragType, x: rel.x - 40, y: rel.y - 20, config: {} };
        aizNodes.push(newNode);
        renderNodes();
        for (const other of aizNodes) {
          if (other.id === newNode.id) continue;
          const otherEl = canvas.querySelector(`[data-id="${other.id}"]`) as HTMLElement;
          if (!otherEl) continue;
          const dist = Math.hypot(other.x - newNode.x, (other.y + otherEl.offsetHeight / 2) - (newNode.y + 40));
          if (dist < PROXIMITY_THRESHOLD) {
            const existing = aizConnections.find((c) => c.fromId === other.id && c.toId === newNode.id);
            if (!existing) {
              aizConnections.push({ id: "conn_" + Date.now(), fromId: other.id, toId: newNode.id });
            }
            break;
          }
        }
        renderConnections();
        syncWorkflowSelect();
        selectedNodeId = newNode.id;
        renderNodes();
        showConfigPanel(newNode);
      } else {
        const centerX = cRect.width / 2;
        const centerY = cRect.height / 2;
        const newNode: AizNode = { id: generateId(), type: aizDragType, x: centerX - 40, y: centerY - 20, config: {} };
        aizNodes.push(newNode);
        renderNodes();
        renderConnections();
        syncWorkflowSelect();
        selectedNodeId = newNode.id;
        renderNodes();
        showConfigPanel(newNode);
      }
      aizPaletteGhost.remove();
      aizPaletteGhost = null;
      aizDragType = null;
      canvas.classList.remove("drag-over");
      return;
    }
    if (aizDragNode) {
      aizDragNode = null;
    }
  });

  btnRun.addEventListener("click", async () => {
    if (aizNodes.length === 0) return;
    if (aizIsRunning) return;
    aizIsRunning = true;
    aizStopRequested = false;
    btnRun.classList.add("hidden");
    btnStop.classList.remove("hidden");

    aizOutputEl!.classList.remove("hidden");
    aizOutputEl!.innerHTML = `<div class="aiz-output-header">Workflow Output</div>
<div class="aiz-output-item aiz-spinner">
  <span class="neon-loader" aria-hidden="true">
    <span class="sq"></span><span class="sq"></span><span class="sq"></span>
    <span class="sq"></span><span class="sq"></span><span class="sq"></span>
    <span class="sq"></span><span class="sq"></span><span class="sq"></span>
  </span>
  <span>Working...</span>
</div>`;

    const runWorkflow = async () => {
      const sorted = topologicalSort(aizNodes, aizConnections);

      // Remove loading spinner
      const spinner = aizOutputEl!.querySelector(".aiz-spinner");
      if (spinner) spinner.remove();

      for (const node of sorted) {
        if (aizStopRequested) {
          const stopDiv = document.createElement("div");
          stopDiv.className = "aiz-output-item";
          stopDiv.textContent = "⏹ Workflow stopped";
          stopDiv.style.color = "#f59e0b";
          aizOutputEl!.appendChild(stopDiv);
          scrollOutputToBottom(aizOutputEl!);
          break;
        }
        const nodeEl = canvas.querySelector(`[data-id="${node.id}"]`) as HTMLElement;
        if (nodeEl) nodeEl.classList.add("running");
        const outDiv = document.createElement("div");
        outDiv.className = "aiz-output-item";
        outDiv.textContent = `Running ${getNodeLabel(node.type)} node...`;
        aizOutputEl!.appendChild(outDiv);
        scrollOutputToBottom(aizOutputEl!);
        try {
          if (node.type === "program") {
            const appName = node.config.appName;
            if (appName) {
              outDiv.textContent = `Launching: ${appName}`;
              try {
                const programs = await invoke<RunningProgram[]>("get_running_programs");
                const found = programs.find((p) => p.name === appName || p.title?.includes(appName));
                if (found && found.pid > 0) {
                  outDiv.textContent = `Already running: ${appName} (PID: ${found.pid})`;
                  outDiv.style.color = "#22c55e";
                  try {
                    await invoke("activate_application", { name: appName });
                    const focusDiv = document.createElement("div");
                    focusDiv.className = "aiz-output-item";
                    focusDiv.textContent = `Brought to front: ${appName}`;
                    focusDiv.style.color = "#22c55e";
                    aizOutputEl!.appendChild(focusDiv);
                    scrollOutputToBottom(aizOutputEl!);
                  } catch (focusErr) {
                    const warnDiv = document.createElement("div");
                    warnDiv.className = "aiz-output-item";
                    warnDiv.textContent = `Focus warning: ${String(focusErr)}`;
                    warnDiv.style.color = "#f59e0b";
                    aizOutputEl!.appendChild(warnDiv);
                    scrollOutputToBottom(aizOutputEl!);
                  }
                } else {
                  await invoke("launch_application", { name: appName });
                  outDiv.textContent = `Launched: ${appName}`;
                  outDiv.style.color = "#22c55e";
                  try { await invoke("activate_application", { name: appName }); } catch { }
                  await new Promise((r) => setTimeout(r, parseInt(node.config.delay || "2000")));
                  const verifyPrograms = await invoke<RunningProgram[]>("get_running_programs");
                  const verifyFound = verifyPrograms.find((p) => p.name === appName || p.title?.includes(appName));
                  if (verifyFound) {
                    const verifyDiv = document.createElement("div");
                    verifyDiv.className = "aiz-output-item";
                    verifyDiv.textContent = `Verified running: ${appName} (PID: ${verifyFound.pid})`;
                    verifyDiv.style.color = "#22c55e";
                    aizOutputEl!.appendChild(verifyDiv);
                    scrollOutputToBottom(aizOutputEl!);
                  }
                }
              } catch (launchErr) {
                outDiv.textContent = `Launch error: ${launchErr}`;
                outDiv.style.color = "#ef4444";
              }
            } else {
              outDiv.textContent = "No program configured";
              outDiv.style.color = "#f59e0b";
            }
          } else if (node.type === "prompt") {
            const instruction = node.config.instruction;
            // Normalize legacy values that may be persisted in older workflows.
            const rawMode = node.config.visionMode;
            const mode = rawMode === "true" ? "vision"
              : rawMode === "false" ? "text"
                : (rawMode || "text");
            if (instruction) {
              if (mode === "vision" || mode === "vision_coder") {
                const maxIter = parseInt(node.config.visionIterations || "10");
                const prevConns = aizConnections.filter((c) => c.toId === node.id);
                let appContext = "";
                for (const conn of prevConns) {
                  const prevNode = aizNodes.find((n) => n.id === conn.fromId);
                  if (prevNode && prevNode.type === "program" && prevNode.config.appName) {
                    appContext = prevNode.config.appName;
                  }
                }
                const label = mode === "vision_coder"
                  ? `Vision + Coder Agent: starting (vision sees → coder decides, ${maxIter} iterations max)...`
                  : `Vision-Only Agent: starting (vision decides + acts, ${maxIter} iterations max)...`;
                outDiv.textContent = label;
                outDiv.style.color = "#a78bfa";

                const log = (msg: string, color?: string) => {
                  const d = document.createElement("div");
                  d.className = "aiz-output-item";
                  d.textContent = msg;
                  if (color) d.style.color = color;
                  aizOutputEl!.appendChild(d);
                  scrollOutputToBottom(aizOutputEl!);
                };
                const runner = mode === "vision_coder" ? runVisionGuidedAgent : runVisionOnlyAgent;
                if (mode === "vision_coder") {
                  log("Vision + Coder agent active.", "#22c55e");
                }
                const summary = await runner({
                  task: instruction,
                  appContext,
                  maxIterations: maxIter,
                  isStopped: () => aizStopRequested,
                  log,
                });
                node.config._lastOutput = summary;
              } else {
                outDiv.textContent = `AI: ${instruction.substring(0, 60)}...`;
                // Gather predecessor node outputs for context + extract app name from Program nodes
                const prevPromptConns = aizConnections.filter((c) => c.toId === node.id);
                let predecessorContext = "";
                let targetApp = "";
                for (const conn of prevPromptConns) {
                  const prevNode = aizNodes.find((n) => n.id === conn.fromId);
                  if (!prevNode) continue;
                  if (prevNode.type === "program" && prevNode.config.appName) {
                    targetApp = prevNode.config.appName;
                  }
                  if (prevNode.config._lastOutput) {
                    const output = prevNode.config._lastOutput.length > 1500
                      ? prevNode.config._lastOutput.substring(0, 1500) + "...[truncated]"
                      : prevNode.config._lastOutput;
                    predecessorContext += `[Previous ${getNodeLabel(prevNode.type)} node output]: ${output}\n`;
                  }
                }
                const userContent = predecessorContext
                  ? `${predecessorContext}\nCurrent task: ${instruction}`
                  : instruction;
                const appHint = targetApp
                  ? `\n\n**IMPORTANT: The user has already launched "${targetApp}" in the previous step. This is the active application. Do NOT launch a different app — use "${targetApp}" for all actions (address bar, navigation, etc). The app is already running and focused.**`
                  : "";
                const messages: ChatMessage[] = [
                  { role: "system", content: "You are a desktop automation assistant for local app workflows. This is universal desktop automation, not browser-only: use the active target application, its native shortcuts, menus, controls, text fields, windows, and coordinates as appropriate. Output tool calls using native desktop tools only (no MCP server field). Use this exact format:\n```tool_call\n{\"tool\": \"tool_name\", \"arguments\": {\"key\": \"value\"}}\n```\n\nAvailable native tools: launch_application, get_running_programs, get_screen_size, screenshot, click_at, long_press_at, scroll_at, drag, type_text, press_key_combo, get_active_window_bounds, get_active_window_edges, window_control_action, right_click_at, double_click_at, resize_window, move_window, restore_window, agent_get_active_window, agent_get_all_windows, agent_resize_window, agent_move_window, agent_focus_window, agent_type_text, agent_press_key, agent_press_key_combo, agent_launch_app, agent_get_screen_size, agent_get_mouse_position.\n\n**CRITICAL: Multi-step Execution**\nYou MUST break tasks into sequential tool calls and output ALL tool calls in a single response.\nDo NOT just describe what you will do — actually output the tool calls.\nWhen typing numeric expressions into any app, use the actual operator keys the app accepts, such as `*`, `/`, `+`, and `-`, instead of prose words or ambiguous symbols.\nFor example, to open a website in the active browser:\n```tool_call\n{\"tool\": \"press_key_combo\", \"arguments\": {\"keys\": \"command+l\"}}\n```\n```tool_call\n{\"tool\": \"type_text\", \"arguments\": {\"text\": \"https://www.youtube.com\\n\"}}\n```\n\nFor opening a URL in any browser app:\n1) press_key_combo with \"command+l\" to focus the address bar\n2) type_text with the full URL ending in \\n\nIf the app is NOT already running, first use launch_application to start it, then navigate.\n\n**Searching on a website after navigation:**\nAfter navigating to a URL, wait for the page to load, then:\n1) press_key_combo with \"command+f\" to open find/search, OR screenshot to find the search box, then click_at its coordinates\n2) type_text with the search query\n3) press_key_combo with \"return\" to submit\nAlternatively, append the search query directly to the URL (e.g. https://www.youtube.com/results?search_query=QUERY).\n\nIf element location is uncertain, first use screenshot and wait for the returned vision coordinate analysis in the next tool-results turn; then click only with explicit coordinates from that analysis. For tasks that can be completed through keyboard, URLs, known app commands, or deterministic tool calls, do the sequential coder-only actions without using vision. You can click, right-click, double-click, scroll, drag, type, and press key combos. Be concise and practical." + appHint },
                  { role: "user", content: userContent }
                ];

                const MAX_AGENT_ITERS = 5;
                let agentIter = 0;
                let lastCleanText = "";

                while (agentIter < MAX_AGENT_ITERS) {
                  agentIter++;
                  const aiResponse = await streamChat(messages);

                  const cleanedResponse = aiResponse
                    .replace(/```tool_call[\s\S]*?```/g, "")
                    .replace(/```[\s\S]*?```/g, "")
                    .replace(/tool_call\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, "")
                    .replace(/\[\s*"[a-zA-Z0-9_]+"\s*,\s*\{[^}]*\}\s*\]/g, "")
                    .replace(/\{\s*"tool"\s*:\s*"[a-zA-Z0-9_]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g, "")
                    .trim();
                  lastCleanText = cleanedResponse;

                  messages.push({ role: "assistant", content: aiResponse });

                  outDiv.textContent = `AI (step ${agentIter}): ${cleanedResponse.substring(0, 150)}`;
                  outDiv.style.color = "#a78bfa";

                  const toolResults = await parseToolCalls(aiResponse, targetApp || undefined);
                  if (toolResults.length === 0) break;

                  const summaryDiv = document.createElement("div");
                  summaryDiv.className = "aiz-output-item";
                  summaryDiv.textContent = `Step ${agentIter} — Tools executed: ${toolResults.length}`;
                  summaryDiv.style.color = "#22c55e";
                  aizOutputEl!.appendChild(summaryDiv);
                  scrollOutputToBottom(aizOutputEl!);
                  for (const result of toolResults) {
                    const toolDiv = document.createElement("div");
                    toolDiv.className = "aiz-output-item";
                    toolDiv.textContent = `✅ ${result.server_name}/${result.tool_name}: ${result.result.substring(0, 140)}`;
                    toolDiv.style.color = "#22c55e";
                    aizOutputEl!.appendChild(toolDiv);
                    scrollOutputToBottom(aizOutputEl!);
                  }

                  let toolSummary = toolResults
                    .map((tr) => {
                      const r = tr.result.length > 800 ? tr.result.substring(0, 800) + "...[truncated]" : tr.result;
                      return `${tr.tool_name}: ${r}`;
                    })
                    .join("\n");

                  // Vision assist: if screenshot was taken, analyze it with vision model
                  const hasScreenshot = toolResults.some((tr) => tr.tool_name === "screenshot");
                  if (hasScreenshot) {
                    try {
                      const visionBase64 = await captureScreen();
                      if (visionBase64) {
                        const visionAnalysisMessages: VisionMessage[] = [
                          { role: "system", content: RICH_VISION_LOCATOR_PROMPT },
                          {
                            role: "user",
                            content: [
                              { type: "image_url", image_url: { url: `data:image/png;base64,${visionBase64}` } },
                              { type: "text", text: `Task context: ${instruction}\n\nReturn the full JSON map (program, window, tools, text_blocks, sentences, words, columns, rows) for the active target program window.` },
                            ],
                          },
                        ];
                        const visionAnalysis = await streamVisionChat(visionAnalysisMessages);

                        const visionDiv = document.createElement("div");
                        visionDiv.className = "aiz-output-item";
                        visionDiv.textContent = `🔍 Vision analysis: ${visionAnalysis}`;
                        visionDiv.style.color = "#38bdf8";
                        visionDiv.style.whiteSpace = "pre-wrap";
                        aizOutputEl!.appendChild(visionDiv);
                        scrollOutputToBottom(aizOutputEl!);

                        const truncatedVision = visionAnalysis.length > 24000
                          ? visionAnalysis.substring(0, 24000) + "...[truncated]"
                          : visionAnalysis;
                        toolSummary += `\n\n[Vision model analyzed the screenshot and found these UI elements]:\n${truncatedVision}`;
                      }
                    } catch (visionErr) {
                      const visionErrDiv = document.createElement("div");
                      visionErrDiv.className = "aiz-output-item";
                      visionErrDiv.textContent = `⚠ Vision analysis failed: ${String(visionErr).substring(0, 100)}`;
                      visionErrDiv.style.color = "#f59e0b";
                      aizOutputEl!.appendChild(visionErrDiv);
                      scrollOutputToBottom(aizOutputEl!);
                    }
                  }

                  messages.push({
                    role: "user",
                    content: `Tool results:\n${toolSummary}\n\nIf the task is not yet complete, continue with the next tool calls. If done, respond with a brief summary.`,
                  });
                }

                node.config._lastOutput = lastCleanText;
                outDiv.textContent = `AI: ${lastCleanText.substring(0, 200)}`;
                outDiv.style.color = "#a78bfa";
              }
            } else {
              outDiv.textContent = "No instruction configured";
              outDiv.style.color = "#f59e0b";
            }
          } else if (node.type === "save") {
            const filename = node.config.filename || "output";
            const format = node.config.format || "txt";
            const path = node.config.path || "";
            const prevNodes = aizConnections.filter((c) => c.toId === node.id);
            let content = `Workflow output at ${new Date().toISOString()}\n`;
            if (prevNodes.length > 0) {
              for (const prevConn of prevNodes) {
                const prevNode = aizNodes.find((n) => n.id === prevConn.fromId);
                if (prevNode) {
                  const output = prevNode.config._lastOutput || JSON.stringify(prevNode.config);
                  content += `\nFrom ${getNodeLabel(prevNode.type)}: ${output}\n`;
                }
              }
            }
            const savedPath = await invoke<string>("save_file", { filename, content, format, path: path || null });
            outDiv.textContent = `Saved: ${savedPath}`;
            outDiv.style.color = "#22c55e";
          } else {
            const customDef = customNodeTypes.find((c) => c.id === node.type);
            if (customDef && customDef.executionCode) {
              const prevConns = aizConnections.filter((c) => c.toId === node.id);
              let previousOutput = "";
              if (prevConns.length > 0) {
                const prevNode = aizNodes.find((n) => n.id === prevConns[0].fromId);
                if (prevNode) previousOutput = prevNode.config._lastOutput || JSON.stringify(prevNode.config);
              }
              const fn = AsyncFunction("config", "output", "fetch", "invoke", customDef.executionCode) as (...args: unknown[]) => Promise<unknown>;
              const result = await fn(node.config, previousOutput, fetch.bind(window), createWorkflowInvoke());
              node.config._lastOutput = result != null ? String(result) : "";
              outDiv.textContent = result != null ? String(result).substring(0, 200) : "(no output)";
              outDiv.style.color = "#a78bfa";
            } else {
              outDiv.textContent = `Unknown node type: ${node.type}`;
              outDiv.style.color = "#f59e0b";
            }
          }
        } catch (err) {
          outDiv.textContent = `Error in ${getNodeLabel(node.type)}: ${err}`;
          outDiv.style.color = "#ef4444";
        }
        if (nodeEl) nodeEl.classList.remove("running");
      }

      if (!aizStopRequested) {
        const doneDiv = document.createElement("div");
        doneDiv.className = "aiz-output-item";
        doneDiv.textContent = "✅ Workflow complete";
        doneDiv.style.color = "#22c55e";
        aizOutputEl!.appendChild(doneDiv);
        scrollOutputToBottom(aizOutputEl!);
      }
    };

    if (aizRunMode === "loop") {
      await runWorkflow();
      if (!aizStopRequested) {
        aizLoopInterval = window.setInterval(async () => {
          if (aizStopRequested) {
            clearInterval(aizLoopInterval as number);
            aizLoopInterval = null;
            return;
          }
          await runWorkflow();
        }, 3000);
      }
    } else if (aizRunMode === "multiple") {
      const totalRuns = Math.max(1, Math.min(1000, aizRunCount));
      for (let i = 0; i < totalRuns; i++) {
        if (aizStopRequested) break;
        const runHeader = document.createElement("div");
        runHeader.className = "aiz-output-item";
        runHeader.style.color = "#38bdf8";
        runHeader.style.fontWeight = "700";
        runHeader.textContent = `── Run ${i + 1} of ${totalRuns} ──`;
        aizOutputEl!.appendChild(runHeader);
        scrollOutputToBottom(aizOutputEl!);
        await runWorkflow();
      }
    } else {
      await runWorkflow();
    }

    aizIsRunning = false;
    btnRun.classList.remove("hidden");
    btnStop.classList.add("hidden");
  });

  btnStop.addEventListener("click", () => {
    aizStopRequested = true;
    stopAllWorkflowContexts();
    if (aizLoopInterval) {
      clearInterval(aizLoopInterval);
      aizLoopInterval = null;
    }
    aizIsRunning = false;
    btnRun.classList.remove("hidden");
    btnStop.classList.add("hidden");
  });

  runModeSelect.addEventListener("change", () => {
    aizRunMode = runModeSelect.value as "once" | "loop" | "parallel" | "multiple";
    if (aizRunMode === "multiple") {
      runCountInput.classList.remove("hidden");
    } else {
      runCountInput.classList.add("hidden");
    }
  });

  runCountInput.addEventListener("input", () => {
    aizRunCount = parseInt(runCountInput.value) || 3;
  });

  btnClear.addEventListener("click", () => {
    aizNodes = [];
    aizConnections = [];
    selectedNodeId = null;
    aizPendingConnection = null;
    configPanel.classList.add("hidden");
    renderNodes();
    syncWorkflowSelect();
    aizOutputEl!.classList.add("hidden");
  });

  function syncWorkflowSelect(): void {
    workflowSelect.innerHTML = '<option value="">Load workflow...</option>';
    const sorted = [...savedAizWorkflows].sort((a, b) => a.name.localeCompare(b.name));
    for (const workflow of sorted) {
      const opt = document.createElement("option");
      opt.value = workflow.id;
      opt.textContent = workflow.name;
      workflowSelect.appendChild(opt);
    }
  }

  function loadWorkflowById(workflowId: string): void {
    const workflow = savedAizWorkflows.find((w) => w.id === workflowId);
    if (!workflow) return;
    aizNodes = cloneAizNodes(workflow.nodes || []);
    aizConnections = cloneAizConnections(workflow.connections || []);
    selectedNodeId = null;
    configPanel.classList.add("hidden");
    aizRunMode = workflow.runMode || "once";
    aizRunCount = workflow.runCount || 3;
    runModeSelect.value = aizRunMode;
    runCountInput.value = String(aizRunCount);
    if (aizRunMode === "multiple") runCountInput.classList.remove("hidden");
    else runCountInput.classList.add("hidden");
    workflowSelect.value = workflow.id;
    renderNodes();
  }

  btnSave.addEventListener("click", () => {
    const selectedWorkflowId = workflowSelect.value;
    const selectedWorkflow = selectedWorkflowId ? savedAizWorkflows.find((w) => w.id === selectedWorkflowId) : undefined;
    const suggestedName = selectedWorkflow?.name || `Aiz Workflow ${savedAizWorkflows.length + 1}`;
    const enteredName = window.prompt("Workflow name:", suggestedName);
    const normalized = (enteredName ?? suggestedName).trim() || suggestedName;
    const existing =
      (selectedWorkflowId ? savedAizWorkflows.find((w) => w.id === selectedWorkflowId) : undefined) ||
      savedAizWorkflows.find((w) => w.name.toLowerCase() === normalized.toLowerCase());
    const now = new Date().toISOString();
    const record: AizWorkflowRecord = {
      id: existing?.id || `aizwf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: normalized,
      nodes: cloneAizNodes(aizNodes),
      connections: cloneAizConnections(aizConnections),
      runMode: aizRunMode,
      runCount: aizRunCount,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) {
      Object.assign(existing, record);
    } else {
      savedAizWorkflows.unshift(record);
    }
    saveAizWorkflows();
    upsertAizWorkflowSkill(record);
    syncWorkflowSelect();
    renderSkills();
    renderAizWorkflowList();
    workflowSelect.value = record.id;
    const outDiv = document.createElement("div");
    outDiv.className = "aiz-output-item";
    outDiv.textContent = `Workflow "${normalized}" saved`;
    outDiv.style.color = "#22c55e";
    aizOutputEl!.classList.remove("hidden");
    aizOutputEl!.appendChild(outDiv);
    scrollOutputToBottom(aizOutputEl!);
  });

  workflowSelect.addEventListener("change", () => {
    if (!workflowSelect.value) return;
    loadWorkflowById(workflowSelect.value);
    syncWorkflowSelect();
  });

  openAndLoadAizWorkflow = (workflowId: string, autoRun = false) => {
    const wf = savedAizWorkflows.find((w) => w.id === workflowId);
    if (!wf) return;
    aizSkillBackdrop.classList.remove("hidden");
    aizSkillWidget.classList.remove("hidden");
    loadWorkflowById(workflowId);
    if (autoRun && !aizIsRunning) {
      window.setTimeout(() => { btnRun.click(); }, 40);
    }
  };

  const btnPlayAll = document.getElementById("aiz-play-all") as HTMLButtonElement;
  const btnStopAll = document.getElementById("aiz-stop-all") as HTMLButtonElement;
  const playAllOutput = document.getElementById("aiz-play-all-output") as HTMLDivElement;
  let playAllStopSignal: { stop: boolean } | null = null;

  if (btnPlayAll && btnStopAll && playAllOutput) {
    btnPlayAll.addEventListener("click", async () => {
      if (aizPlayAllRunning) return;
      const workflows = savedAizWorkflows;
      if (workflows.length === 0) {
        return;
      }
      aizPlayAllRunning = true;
      btnPlayAll.classList.add("hidden");
      btnStopAll.classList.remove("hidden");
      playAllOutput.classList.remove("hidden");
      playAllOutput.innerHTML = "";

      playAllStopSignal = { stop: false };

      const wfSections = workflows.map((wf, i) => {
        const section = document.createElement("div");
        section.className = "aiz-parallel-wf";

        const header = document.createElement("div");
        header.className = "aiz-parallel-wf-header";
        header.innerHTML = `
          <span class="aiz-parallel-name">${wf.name}</span>
          <span class="aiz-parallel-status running">Running</span>
        `;

        const log = document.createElement("div");
        log.className = "aiz-parallel-wf-log";

        section.appendChild(header);
        section.appendChild(log);
        playAllOutput.appendChild(section);
        scrollOutputToBottom(playAllOutput);
        return { section, header, log, wf, i };
      });

      await Promise.all(workflows.map((wf, i) =>
        executeWorkflowStandalone(
          wf.nodes || [],
          wf.connections || [],
          customNodeTypes,
          wfSections[i].log,
          playAllStopSignal!
        ).then(() => {
          const statusEl = wfSections[i].header.querySelector(".aiz-parallel-status");
          if (statusEl) {
            statusEl.className = "aiz-parallel-status done";
            statusEl.textContent = "Done";
          }
        }).catch((err) => {
          const statusEl = wfSections[i].header.querySelector(".aiz-parallel-status");
          if (statusEl) {
            statusEl.className = "aiz-parallel-status error";
            statusEl.textContent = "Error";
          }
          const errDiv = document.createElement("div");
          errDiv.className = "aiz-output-item";
          errDiv.style.color = "#ef4444";
          errDiv.textContent = `Workflow error: ${err}`;
          wfSections[i].log.appendChild(errDiv);
          scrollOutputToBottom(wfSections[i].log);
        })
      ));

      aizPlayAllRunning = false;
      btnPlayAll.classList.remove("hidden");
      btnStopAll.classList.add("hidden");
    });

    btnStopAll.addEventListener("click", () => {
      if (playAllStopSignal) playAllStopSignal.stop = true;
      stopAllWorkflowContexts(); // Stop all isolated workflow contexts
      btnStopAll.classList.add("hidden");
      btnPlayAll.classList.remove("hidden");
    });
  }

  const customNodesContainer = document.getElementById("aiz-custom-nodes") as HTMLDivElement;
  const creatorPanel = document.getElementById("aiz-creator-panel") as HTMLDivElement;
  const addNodeBtn = document.getElementById("aiz-add-node-btn") as HTMLButtonElement;
  const creatorClose = document.getElementById("aiz-creator-close") as HTMLButtonElement;
  const creatorSave = document.getElementById("aiz-creator-save") as HTMLButtonElement;
  const creatorName = document.getElementById("aiz-creator-name") as HTMLInputElement;
  const creatorIcon = document.getElementById("aiz-creator-icon") as HTMLInputElement;
  const creatorDesc = document.getElementById("aiz-creator-desc") as HTMLInputElement;
  const creatorColor = document.getElementById("aiz-creator-color") as HTMLSelectElement;
  const creatorFields = document.getElementById("aiz-creator-fields") as HTMLTextAreaElement;
  const creatorCode = document.getElementById("aiz-creator-code") as HTMLTextAreaElement;
  const creatorAiBtn = document.getElementById("aiz-creator-ai-btn") as HTMLButtonElement;
  const creatorAiPrompt = document.getElementById("aiz-creator-ai-prompt") as HTMLInputElement;
  const creatorAiStatus = document.getElementById("aiz-creator-ai-status") as HTMLDivElement;

  function renderPaletteCustomNodes(): void {
    customNodesContainer.innerHTML = "";
    for (const cnt of customNodeTypes) {
      if (!isCustomNodeCodeSyntacticallyValid(cnt.executionCode)) {
        console.warn(`Skipping invalid custom node "${cnt.name}" because its execution code does not compile.`);
        continue;
      }
      const el = document.createElement("div");
      el.className = "aiz-node-type aiz-node-type-custom";
      el.dataset.type = cnt.id;
      el.innerHTML = `
        <div class="aiz-node-type-icon" style="background:${cnt.color}22;color:${cnt.color}">${cnt.icon}</div>
        <div class="aiz-node-type-info">
          <div class="aiz-node-type-name">${cnt.name}</div>
          <div class="aiz-node-type-desc">${cnt.description}</div>
        </div>
        <button class="aiz-node-type-delete" data-custom-id="${cnt.id}" title="Delete custom node type">×</button>
      `;
      customNodesContainer.appendChild(el);
    }
    customNodesContainer.querySelectorAll(".aiz-node-type-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const cid = (btn as HTMLElement).dataset.customId!;
        customNodeTypes = customNodeTypes.filter((c) => c.id !== cid);
        localStorage.setItem("catog-custom-node-types", JSON.stringify(customNodeTypes));
        aizNodes = aizNodes.filter((n) => n.type !== cid);
        const removedNodeIds = new Set(aizNodes.filter((n) => n.type === cid).map((n) => n.id));
        aizConnections = aizConnections.filter((c) => !removedNodeIds.has(c.fromId) && !removedNodeIds.has(c.toId));
        selectedNodeId = removedNodeIds.has(selectedNodeId || "") ? null : selectedNodeId;
        renderNodes();
        renderPaletteCustomNodes();
      });
    });
  }

  const isFileFolderOpenerCustomNode = (customDef: CustomNodeType): boolean => {
    const haystack = `${customDef.name} ${customDef.description}`.toLowerCase();
    return haystack.includes("file") && haystack.includes("folder") && (haystack.includes("open") || haystack.includes("opener"));
  };

  const isPathPickerField = (field: CustomNodeConfigField): boolean => {
    const haystack = `${field.key} ${field.label} ${field.placeholder || ""}`.toLowerCase();
    return /\b(path|file|folder|directory|location)\b/.test(haystack);
  };

  const selectCustomPath = async (input: HTMLInputElement, mode: "file" | "folder"): Promise<void> => {
    const command = mode === "file" ? "select_file" : "select_folder";
    const selectedPath = await invoke<string | null>(command);
    if (!selectedPath) return;
    input.value = selectedPath;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  addNodeBtn.addEventListener("click", () => {
    creatorPanel.classList.remove("hidden");
    addNodeBtn.classList.add("hidden");
  });

  creatorClose.addEventListener("click", () => {
    creatorPanel.classList.add("hidden");
    addNodeBtn.classList.remove("hidden");
  });

  creatorSave.addEventListener("click", async () => {
    const name = creatorName.value.trim();
    const icon = creatorIcon.value.trim() || "⚙️";
    const desc = creatorDesc.value.trim();
    const color = creatorColor.value;
    const fieldsRaw = creatorFields.value.trim();
    const code = creatorCode.value.trim();
    if (!name) { creatorName.focus(); return; }
    let configFields: CustomNodeConfigField[] = [];
    if (fieldsRaw) {
      try {
        configFields = parseConfigFieldsCandidate(JSON.parse(fieldsRaw));
        if (configFields.length === 0) throw new Error("No valid config fields found.");
      } catch {
        creatorFields.focus();
        creatorAiStatus.textContent = "Error: Config Fields must be valid JSON field definitions.";
        creatorAiStatus.style.color = "#ef4444";
        return;
      }
    }
    creatorSave.disabled = true;
    creatorAiStatus.textContent = "Testing node before listing...";
    creatorAiStatus.style.color = "#a78bfa";
    const validation = await validateCustomNodeCode(code, configFields, `${name}\n${desc}`);
    if (!validation.ok) {
      creatorSave.disabled = false;
      creatorCode.focus();
      creatorAiStatus.textContent = "Error: " + validation.error.substring(0, 140);
      creatorAiStatus.style.color = "#ef4444";
      return;
    }
    const id = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now();
    const customType: CustomNodeType = { id, name, icon, description: desc, color, configFields, executionCode: code };
    customNodeTypes.push(customType);
    localStorage.setItem("catog-custom-node-types", JSON.stringify(customNodeTypes));
    renderPaletteCustomNodes();
    creatorPanel.classList.add("hidden");
    addNodeBtn.classList.remove("hidden");
    creatorName.value = "";
    creatorIcon.value = "";
    creatorDesc.value = "";
    creatorColor.value = "#3b82f6";
    creatorFields.value = "";
    creatorCode.value = "";
    creatorAiStatus.textContent = `Created. Test output: ${validation.output.substring(0, 80)}`;
    creatorAiStatus.style.color = "#22c55e";
    creatorSave.disabled = false;
  });

  const allowedFieldTypes = new Set<CustomNodeConfigField["type"]>(["text", "textarea", "select", "number"]);
  const normalizeAliasKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const toConfigFieldKey = (value: string): string => {
    const words = value.trim().toLowerCase().match(/[a-z0-9]+/g) || [];
    if (words.length === 0) return "";
    return words.map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join("");
  };

  const parseConfigFieldsCandidate = (value: unknown): CustomNodeConfigField[] => {
    if (Array.isArray(value)) {
      return value
        .map((f) => sanitizeGeneratedField(f))
        .filter((f): f is CustomNodeConfigField => !!f);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .map((f) => sanitizeGeneratedField(f))
            .filter((f): f is CustomNodeConfigField => !!f);
        }
      } catch {
        return [];
      }
    }
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      const fields: CustomNodeConfigField[] = [];
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "string") {
          const key = toConfigFieldKey(k);
          if (key) fields.push({ key, label: k, type: "text", placeholder: v });
        } else if (v && typeof v === "object") {
          const mapped = sanitizeGeneratedField({ key: k, ...(v as Record<string, unknown>) });
          if (mapped) fields.push(mapped);
        }
      }
      return fields;
    }
    return [];
  };

  const sanitizeGeneratedField = (raw: unknown): CustomNodeConfigField | null => {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const key = toConfigFieldKey(String(obj.key ?? obj.name ?? obj.id ?? obj.label ?? "").trim());
    if (!key) return null;
    const label = String(obj.label ?? key).trim() || key;
    const rawTypeAlias = String(obj.type ?? obj.kind ?? "text").trim().toLowerCase();
    const rawType = (rawTypeAlias === "string" || rawTypeAlias === "input") ? "text"
      : (rawTypeAlias === "longtext" || rawTypeAlias === "multiline") ? "textarea"
        : rawTypeAlias as CustomNodeConfigField["type"];
    const type: CustomNodeConfigField["type"] = allowedFieldTypes.has(rawType) ? rawType : "text";
    const field: CustomNodeConfigField = { key, label, type };
    if (typeof obj.placeholder === "string" && obj.placeholder.trim()) {
      field.placeholder = obj.placeholder;
    } else if (typeof obj.description === "string" && obj.description.trim()) {
      field.placeholder = obj.description;
    }
    if (type === "select") {
      const rawOptions = obj.options ?? obj.choices ?? obj.values;
      const options = Array.isArray(rawOptions)
        ? rawOptions.map((v) => String(v).trim()).filter((v) => v.length > 0)
        : typeof rawOptions === "string"
          ? rawOptions.split(/[,|]/).map((v) => v.trim()).filter((v) => v.length > 0)
          : [];
      if (options.length > 0) field.options = options;
    }
    return field;
  };

  const sanitizeGeneratedNodeDefinition = (raw: unknown): {
    name?: string;
    icon?: string;
    description?: string;
    color?: string;
    configFields?: CustomNodeConfigField[];
    executionCode?: string;
  } => {
    if (!raw || typeof raw !== "object") return {};
    const root = raw as Record<string, unknown>;

    const collectObjects = (value: unknown, depth: number, out: Record<string, unknown>[]): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        if (depth <= 0) return;
        for (const item of value) collectObjects(item, depth - 1, out);
        return;
      }
      const obj = value as Record<string, unknown>;
      out.push(obj);
      if (depth <= 0) return;
      for (const nested of Object.values(obj)) collectObjects(nested, depth - 1, out);
    };

    const candidates: Record<string, unknown>[] = [];
    collectObjects(root, 2, candidates);

    const readByAliases = (aliases: string[]): unknown => {
      const aliasSet = new Set(aliases.map(normalizeAliasKey));
      for (const candidate of candidates) {
        for (const [k, v] of Object.entries(candidate)) {
          if (aliasSet.has(normalizeAliasKey(k))) return v;
        }
      }
      return undefined;
    };

    const readStringByAliases = (aliases: string[]): string | undefined => {
      const value = readByAliases(aliases);
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const normalized: {
      name?: string;
      icon?: string;
      description?: string;
      color?: string;
      configFields?: CustomNodeConfigField[];
      executionCode?: string;
    } = {};

    const name = readStringByAliases(["name", "nodeName", "title", "node"]);
    if (name) normalized.name = name;

    const icon = readStringByAliases(["icon", "emoji", "symbol"]);
    if (icon) normalized.icon = icon;

    const description = readStringByAliases(["description", "desc", "summary", "details"]);
    if (description) normalized.description = description;

    const colorRaw = readStringByAliases(["color", "colour", "nodeColor", "themeColor"]);
    if (colorRaw) {
      const match = colorRaw.match(/#[0-9a-f]{6}/i);
      if (match) normalized.color = match[0];
    }

    const fieldsRaw = readByAliases([
      "configFields",
      "config_fields",
      "config fields",
      "config fields json",
      "fields",
      "configurationFields",
      "parameters",
      "inputs"
    ]);
    const fields = parseConfigFieldsCandidate(fieldsRaw);
    if (fields.length > 0) normalized.configFields = fields;

    const executionRaw = readStringByAliases([
      "executionCode",
      "execution_code",
      "execution code",
      "execution code js",
      "code",
      "javascript",
      "js"
    ]);
    if (executionRaw) {
      let executionCode = executionRaw;
      const fenced = executionCode.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) executionCode = fenced[1].trim();
      normalized.executionCode = executionCode;
    }

    return normalized;
  };

  const customNodeGeneratorSystemPrompt = `You are a node definition generator for a visual workflow builder.
Return only one valid JSON object. Do not include markdown, explanations, or reasoning.
The JSON object must use exactly these top-level keys:
- "name": short string, 1-3 words
- "icon": single emoji string
- "description": one sentence string
- "color": hex color string like "#3b82f6"
- "configFields": array of objects. Each field must have { "key", "label", "type" } plus optional "placeholder" or "options".
- "executionCode": JavaScript body string used as AsyncFunction("config", "output", "fetch", "invoke", executionCode)
Allowed field types are "text", "textarea", "select", and "number".
Every config field key must be camelCase and must be used by executionCode through config.<key> or config["<key>"].
Every value required by executionCode must have a matching configFields entry with a clear key and placeholder.
executionCode must be valid JavaScript statements, not a function wrapper, and must return a string.
Your generated node will be dry-run in an automatic simulation built from the requested node, configFields, referenced config keys, previous output, fetch responses, and invoke calls.
Write deterministic code that can run against sample data during this simulation and against real data during workflow execution.
Runtime environment: browser/Tauri frontend JavaScript. Node.js APIs are unavailable.
Never use require(), import, module.exports, exports, process, Buffer, fs, path, cheerio, jsdom, or npm packages.
Available APIs include fetch, DOMParser, URL, URLSearchParams, JSON, RegExp, Date, Math, config, output, and invoke.
Use await for async calls, for example: const html = await (await fetch(config.url)).text(); return html;
For page scraping, use fetch plus DOMParser or regular expressions. For user-supplied page HTML, parse output.
Do not throw errors for empty config during generation; use defaults like const dir = config.directoryPath || "/tmp";.
Never write invalid declarations like "const html fetch(...)"; always use "=" and await where needed.
Good scraper executionCode example: const html = await (await fetch(config.url)).text(); const doc = new DOMParser().parseFromString(html, "text/html"); return Array.from(doc.querySelectorAll("h1,h2,a")).slice(0, 20).map((el) => el.textContent?.trim()).filter(Boolean).join("\\n") || html.slice(0, 1000);
Simple formatter executionCode example: const prefix = config.prefix || "Result"; return prefix + ": " + String(output || "");`;

  const countGeneratedNodeFields = (parsed: {
    name?: string;
    icon?: string;
    description?: string;
    color?: string;
    configFields?: CustomNodeConfigField[];
    executionCode?: string;
  }): number => [parsed.name, parsed.icon, parsed.description, parsed.color, parsed.configFields, parsed.executionCode]
    .filter((v) => v !== undefined).length;

  const requestGeneratedNodeDefinition = async (prompt: string): Promise<{
    name?: string;
    icon?: string;
    description?: string;
    color?: string;
    configFields?: CustomNodeConfigField[];
    executionCode?: string;
  }> => {
    const messages: ChatMessage[] = [
      { role: "system", content: customNodeGeneratorSystemPrompt },
      { role: "user", content: prompt }
    ];

    const aiResponse = await completeChatJson(messages);
    let parsedRaw: unknown;
    try {
      parsedRaw = extractJsonFromResponse(aiResponse);
    } catch {
      const repairedResponse = await completeChatJson([
        { role: "system", content: `${customNodeGeneratorSystemPrompt}\nConvert the user's request into the required JSON object. Ignore and do not repeat any reasoning prose.` },
        { role: "user", content: `Original request:\n${prompt}\n\nPrevious invalid response:\n${aiResponse}` }
      ]);
      parsedRaw = extractJsonFromResponse(repairedResponse);
    }

    let parsed = sanitizeGeneratedNodeDefinition(parsedRaw);
    if (countGeneratedNodeFields(parsed) === 0) {
      const repairedResponse = await completeChatJson([
        { role: "system", content: `${customNodeGeneratorSystemPrompt}\nMap any alternate labels, wrapper objects, or grouped configuration sections into the required JSON schema.` },
        { role: "user", content: `Original request:\n${prompt}\n\nParsed but unmapped JSON:\n${JSON.stringify(parsedRaw)}` }
      ]);
      parsed = sanitizeGeneratedNodeDefinition(extractJsonFromResponse(repairedResponse));
    }

    if (countGeneratedNodeFields(parsed) === 0) {
      throw new Error("AI response was parsed but did not contain usable node fields.");
    }
    let validation = await validateCustomNodeCode(parsed.executionCode || "", parsed.configFields || [], prompt);
    for (let repairAttempt = 1; !validation.ok && repairAttempt <= 3; repairAttempt++) {
      const repairedResponse = await completeChatJson([
        { role: "system", content: `${customNodeGeneratorSystemPrompt}\nRepair the JSON so executionCode compiles and passes the automatic simulation dry-run for this specific node. Replace unsupported Node.js/package code with browser-compatible code. If scraping content, use fetch plus DOMParser or RegExp. If using invoke, handle mocked sample responses as well as real responses. Return only the repaired JSON object.` },
        { role: "user", content: `Original request:\n${prompt}\n\nGenerated JSON:\n${JSON.stringify(parsed)}\n\nValidation error:\n${validation.error}\n\nRepair attempt: ${repairAttempt} of 3` }
      ]);
      parsed = sanitizeGeneratedNodeDefinition(extractJsonFromResponse(repairedResponse));
      validation = await validateCustomNodeCode(parsed.executionCode || "", parsed.configFields || [], prompt);
    }
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    return parsed;
  };

  creatorAiBtn.addEventListener("click", async () => {
    const prompt = creatorAiPrompt.value.trim();
    if (!prompt) { creatorAiPrompt.focus(); return; }
    creatorAiBtn.disabled = true;
    creatorAiStatus.textContent = "Generating...";
    creatorAiStatus.style.color = "#a78bfa";
    try {
      const parsed = await requestGeneratedNodeDefinition(prompt);
      if (parsed.name) creatorName.value = parsed.name;
      if (parsed.icon) creatorIcon.value = parsed.icon;
      if (parsed.description) creatorDesc.value = parsed.description;
      if (parsed.color) creatorColor.value = parsed.color;
      if (parsed.configFields) creatorFields.value = JSON.stringify(parsed.configFields, null, 2);
      if (parsed.executionCode) creatorCode.value = parsed.executionCode;
      creatorAiStatus.textContent = "Done! Fields populated.";
      creatorAiStatus.style.color = "#22c55e";
    } catch (err) {
      creatorAiStatus.textContent = "Error: " + String(err).substring(0, 100);
      creatorAiStatus.style.color = "#ef4444";
    }
    creatorAiBtn.disabled = false;
  });

  renderPaletteCustomNodes();
  syncWorkflowSelect();
  renderAizWorkflowList();
}

function getNodeLabel(type: string): string {
  if (type === "program") return "Program";
  if (type === "prompt") return "Prompt";
  if (type === "save") return "Save";
  const custom = customNodeTypes.find((c) => c.id === type);
  return custom ? custom.name : type;
}

function topologicalSort(nodes: AizNode[], connections: AizConnection[]): AizNode[] {
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const n of nodes) { inDegree[n.id] = 0; adj[n.id] = []; }
  for (const c of connections) {
    if (!(c.fromId in adj) || !(c.toId in inDegree)) continue;
    inDegree[c.toId] = (inDegree[c.toId] || 0) + 1;
    adj[c.fromId].push(c.toId);
  }
  const queue: string[] = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adj[id] || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }
  return sorted.map((id) => nodes.find((n) => n.id === id)!);
}

async function executeWorkflowStandalone(
  nodes: AizNode[],
  connections: AizConnection[],
  customNodeTypesArg: CustomNodeType[],
  outputEl: HTMLElement,
  stopSignal: { stop: boolean }
): Promise<void> {
  // Create isolated workflow context with cloned nodes/connections
  const context = createWorkflowContext("standalone-workflow", nodes, connections);
  const sorted = topologicalSort(context.nodes, context.connections);

  const appendOut = (text: string, color = "#e2e8f0") => {
    const d = document.createElement("div");
    d.className = "aiz-output-item";
    d.textContent = text;
    d.style.color = color;
    d.style.whiteSpace = "pre-wrap";
    outputEl.appendChild(d);
    scrollOutputToBottom(outputEl);
  };

  const appendWorkingLoader = () => {
    const d = document.createElement("div");
    d.className = "aiz-output-item aiz-spinner";
    d.innerHTML = `<span class="neon-loader" aria-hidden="true">
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
      <span class="sq"></span><span class="sq"></span><span class="sq"></span>
    </span>
    <span>Working...</span>`;
    outputEl.appendChild(d);
    scrollOutputToBottom(outputEl);
    return d;
  };

  for (const node of sorted) {
    if (stopSignal.stop || context.stopSignal.stop) {
      appendOut("⏹ Workflow stopped", "#f59e0b");
      destroyWorkflowContext(context.id);
      break;
    }
    const workingEl = appendWorkingLoader();
    appendOut(`Running ${getNodeLabel(node.type)} node...`);

    try {
      if (node.type === "program") {
        const appName = node.config.appName;
        if (appName) {
          appendOut(`Launching: ${appName}`);
          try {
            const programs = await invoke<RunningProgram[]>("get_running_programs");
            const found = programs.find((p) => p.name === appName || p.title?.includes(appName));
            if (found && found.pid > 0) {
              appendOut(`Already running: ${appName} (PID: ${found.pid})`, "#22c55e");
              try {
                await invoke("activate_application", { name: appName });
                appendOut(`Brought to front: ${appName}`, "#22c55e");
              } catch (focusErr) {
                appendOut(`Focus warning: ${String(focusErr)}`, "#f59e0b");
              }
            } else {
              await invoke("launch_application", { name: appName });
              appendOut(`Launched: ${appName}`, "#22c55e");
              try { await invoke("activate_application", { name: appName }); } catch { }
              await new Promise((r) => setTimeout(r, parseInt(node.config.delay || "2000")));
              const verifyPrograms = await invoke<RunningProgram[]>("get_running_programs");
              const verifyFound = verifyPrograms.find((p) => p.name === appName || p.title?.includes(appName));
              if (verifyFound) {
                appendOut(`Verified running: ${appName} (PID: ${verifyFound.pid})`, "#22c55e");
              }
            }
          } catch (launchErr) {
            appendOut(`Launch error: ${launchErr}`, "#ef4444");
          }
        } else {
          appendOut("No program configured", "#f59e0b");
        }
      } else if (node.type === "prompt") {
        const instruction = node.config.instruction;
        const rawMode = node.config.visionMode;
        const mode = rawMode === "true" ? "vision"
          : rawMode === "false" ? "text"
            : (rawMode || "text");
        if (instruction) {
          if (mode === "vision" || mode === "vision_coder") {
            const maxIter = parseInt(node.config.visionIterations || "10");
            const prevConns = context.connections.filter((c) => c.toId === node.id);
            let appContext = "";
            for (const conn of prevConns) {
              const prevNode = context.nodes.find((n) => n.id === conn.fromId);
              if (prevNode && prevNode.type === "program" && prevNode.config.appName) {
                appContext = prevNode.config.appName;
              }
            }
            const label = mode === "vision_coder"
              ? `Vision + Coder Agent: starting (vision sees → coder decides, ${maxIter} iterations max)...`
              : `Vision-Only Agent: starting (vision decides + acts, ${maxIter} iterations max)...`;
            appendOut(label, "#a78bfa");

            const runner = mode === "vision_coder" ? runVisionGuidedAgent : runVisionOnlyAgent;
            if (mode === "vision_coder") {
              appendOut("Vision + Coder agent active.", "#22c55e");
            }
            const summary = await runner({
              task: instruction,
              appContext,
              maxIterations: maxIter,
              isStopped: () => stopSignal.stop || context.stopSignal.stop,
              log: (msg, color) => appendOut(msg, color),
            });
            node.config._lastOutput = summary;
          } else {
            appendOut(`AI: ${instruction.substring(0, 60)}...`);
            const prevPromptConns = context.connections.filter((c) => c.toId === node.id);
            let predecessorContext = "";
            let targetApp = "";
            for (const conn of prevPromptConns) {
              const prevNode = context.nodes.find((n) => n.id === conn.fromId);
              if (!prevNode) continue;
              if (prevNode.type === "program" && prevNode.config.appName) {
                targetApp = prevNode.config.appName;
              }
              if (prevNode.config._lastOutput) {
                const output = prevNode.config._lastOutput.length > 1500
                  ? prevNode.config._lastOutput.substring(0, 1500) + "...[truncated]"
                  : prevNode.config._lastOutput;
                predecessorContext += `[Previous ${getNodeLabel(prevNode.type)} node output]: ${output}\n`;
              }
            }
            const userContent = predecessorContext ? `${predecessorContext}\nCurrent task: ${instruction}` : instruction;
            const appHint = targetApp
              ? `\n\n**IMPORTANT: The user has already launched "${targetApp}" in the previous step. This is the active application. Do NOT launch a different app — use "${targetApp}" for all actions (address bar, navigation, etc). The app is already running and focused.**`
              : "";
            const messages: ChatMessage[] = [
              { role: "system", content: "You are a desktop automation assistant for local app workflows. This is universal desktop automation, not browser-only: use the active target application, its native shortcuts, menus, controls, text fields, windows, and coordinates as appropriate. Output tool calls using native desktop tools only (no MCP server field). Use this exact format:\n```tool_call\n{\"tool\": \"tool_name\", \"arguments\": {\"key\": \"value\"}}\n```\n\nAvailable native tools: launch_application, get_running_programs, get_screen_size, screenshot, click_at, long_press_at, scroll_at, drag, type_text, press_key_combo, get_active_window_bounds, get_active_window_edges, window_control_action, right_click_at, double_click_at, resize_window, move_window, restore_window, agent_get_active_window, agent_get_all_windows, agent_resize_window, agent_move_window, agent_focus_window, agent_type_text, agent_press_key, agent_press_key_combo, agent_launch_app, agent_get_screen_size, agent_get_mouse_position.\n\n**CRITICAL: Multi-step Execution**\nYou MUST break tasks into sequential tool calls and output ALL tool calls in a single response.\nDo NOT just describe what you will do — actually output the tool calls.\nWhen typing numeric expressions into any app, use the actual operator keys the app accepts, such as `*`, `/`, `+`, and `-`, instead of prose words or ambiguous symbols.\nFor example, to open a website in the active browser:\n```tool_call\n{\"tool\": \"press_key_combo\", \"arguments\": {\"keys\": \"command+l\"}}\n```\n```tool_call\n{\"tool\": \"type_text\", \"arguments\": {\"text\": \"https://www.youtube.com\\n\"}}\n```\n\nFor opening a URL in any browser app:\n1) press_key_combo with \"command+l\" to focus the address bar\n2) type_text with the full URL ending in \\n\nIf the app is NOT already running, first use launch_application to start it, then navigate.\n\n**Searching on a website after navigation:**\nAfter navigating to a URL, wait for the page to load, then:\n1) press_key_combo with \"command+f\" to open find/search, OR screenshot to find the search box, then click_at its coordinates\n2) type_text with the search query\n3) press_key_combo with \"return\" to submit\nAlternatively, append the search query directly to the URL (e.g. https://www.youtube.com/results?search_query=QUERY).\n\nIf element location is uncertain, first use screenshot and wait for the returned vision coordinate analysis in the next tool-results turn; then click only with explicit coordinates from that analysis. For tasks that can be completed through keyboard, URLs, known app commands, or deterministic tool calls, do the sequential coder-only actions without using vision. You can click, right-click, double-click, scroll, drag, type, and press key combos. Be concise and practical." + appHint },
              { role: "user", content: userContent }
            ];

            const MAX_AGENT_ITERS = 5;
            let agentIter = 0;
            let lastCleanText = "";

            while (agentIter < MAX_AGENT_ITERS) {
              agentIter++;
              const aiResponse = await streamChat(messages);

              const cleanedResponse = aiResponse
                .replace(/```tool_call[\s\S]*?```/g, "")
                .replace(/```[\s\S]*?```/g, "")
                .replace(/tool_call\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, "")
                .replace(/\[\s*"[a-zA-Z0-9_]+"\s*,\s*\{[^}]*\}\s*\]/g, "")
                .replace(/\{\s*"tool"\s*:\s*"[a-zA-Z0-9_]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g, "")
                .trim();
              lastCleanText = cleanedResponse;

              messages.push({ role: "assistant", content: aiResponse });

              appendOut(`AI (step ${agentIter}): ${cleanedResponse.substring(0, 150)}`, "#a78bfa");

              const toolResults = await parseToolCalls(aiResponse, targetApp || undefined);
              if (toolResults.length === 0) break;

              appendOut(`Step ${agentIter} — Tools executed: ${toolResults.length}`, "#22c55e");
              for (const result of toolResults) {
                appendOut(`✅ ${result.server_name}/${result.tool_name}: ${result.result.substring(0, 140)}`, "#22c55e");
              }

              let toolSummary = toolResults
                .map((tr) => {
                  const r = tr.result.length > 800 ? tr.result.substring(0, 800) + "...[truncated]" : tr.result;
                  return `${tr.tool_name}: ${r}`;
                })
                .join("\n");

              const hasScreenshot = toolResults.some((tr) => tr.tool_name === "screenshot");
              if (hasScreenshot) {
                try {
                  const visionBase64 = await captureScreen();
                  if (visionBase64) {
                    const visionAnalysisMessages: VisionMessage[] = [
                      { role: "system", content: RICH_VISION_LOCATOR_PROMPT },
                      {
                        role: "user",
                        content: [
                          { type: "image_url", image_url: { url: `data:image/png;base64,${visionBase64}` } },
                          { type: "text", text: `Task context: ${instruction}\n\nReturn the full JSON map (program, window, tools, text_blocks, sentences, words, columns, rows) for the active target program window.` },
                        ],
                      },
                    ];
                    const visionAnalysis = await streamVisionChat(visionAnalysisMessages);
                    appendOut(`🔍 Vision analysis: ${visionAnalysis}`, "#38bdf8");
                    const truncatedVision = visionAnalysis.length > 24000 ? visionAnalysis.substring(0, 24000) + "...[truncated]" : visionAnalysis;
                    toolSummary += `\n\n[Vision model analyzed the screenshot and found these UI elements]:\n${truncatedVision}`;
                  }
                } catch (visionErr) {
                  appendOut(`⚠ Vision analysis failed: ${String(visionErr).substring(0, 100)}`, "#f59e0b");
                }
              }

              messages.push({ role: "user", content: `Tool results:\n${toolSummary}\n\nIf the task is not yet complete, continue with the next tool calls. If done, respond with a brief summary.` });
            }

            node.config._lastOutput = lastCleanText;
            appendOut(`AI: ${lastCleanText.substring(0, 200)}`, "#a78bfa");
          }
        } else {
          appendOut("No instruction configured", "#f59e0b");
        }
      } else if (node.type === "save") {
        const filename = node.config.filename || "output";
        const format = node.config.format || "txt";
        const path = node.config.path || "";
        const prevNodes = context.connections.filter((c) => c.toId === node.id);
        let content = `Workflow output at ${new Date().toISOString()}\n`;
        if (prevNodes.length > 0) {
          for (const prevConn of prevNodes) {
            const prevNode = context.nodes.find((n) => n.id === prevConn.fromId);
            if (prevNode) {
              const output = prevNode.config._lastOutput || JSON.stringify(prevNode.config);
              content += `\nFrom ${getNodeLabel(prevNode.type)}: ${output}\n`;
            }
          }
        }
        const savedPath = await invoke<string>("save_file", { filename, content, format, path: path || null });
        appendOut(`Saved: ${savedPath}`, "#22c55e");
      } else {
        const customDef = customNodeTypesArg.find((c) => c.id === node.type);
        if (customDef && customDef.executionCode) {
          const prevConns = context.connections.filter((c) => c.toId === node.id);
          let previousOutput = "";
          if (prevConns.length > 0) {
            const prevNode = context.nodes.find((n) => n.id === prevConns[0].fromId);
            if (prevNode) previousOutput = prevNode.config._lastOutput || JSON.stringify(prevNode.config);
          }
          const fn = AsyncFunction("config", "output", "fetch", "invoke", customDef.executionCode) as (...args: unknown[]) => Promise<unknown>;
          const result = await fn(node.config, previousOutput, fetch.bind(window), createWorkflowInvoke());
          node.config._lastOutput = result != null ? String(result) : "";
          appendOut(result != null ? String(result).substring(0, 200) : "(no output)", "#a78bfa");
        } else {
          appendOut(`Unknown node type: ${node.type}`, "#f59e0b");
        }
      }
    } catch (err) {
      appendOut(`Error in ${getNodeLabel(node.type)}: ${err}`, "#ef4444");
    } finally {
      workingEl.remove();
    }
  }

  if (!stopSignal.stop && !context.stopSignal.stop) {
    appendOut("✅ Workflow complete", "#22c55e");
  }

  // Clean up context after workflow completes
  destroyWorkflowContext(context.id);
}

// ── Session ──
function renderSessions(): void {
  sessionListEl.innerHTML = "";
  for (const sess of allSessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (sess.id === activeSessionId ? " active" : "");

    const indicator = document.createElement("span");
    indicator.className = "session-indicator";
    if (sess.id !== activeSessionId) indicator.style.background = "var(--text-muted)";
    if (sess.id !== activeSessionId) indicator.style.boxShadow = "none";

    const info = document.createElement("div");
    info.className = "session-info";

    const titleSpan = document.createElement("span");
    titleSpan.className = "session-title";
    titleSpan.textContent = sess.title;

    const timeSpan = document.createElement("span");
    timeSpan.className = "session-time";
    timeSpan.textContent = new Date(sess.updatedAt).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });

    info.appendChild(titleSpan);
    info.appendChild(timeSpan);

    li.appendChild(indicator);
    li.appendChild(info);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "session-delete-btn";
    deleteBtn.innerHTML = "&#10005;";
    deleteBtn.title = "Delete session";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(sess.id);
    });
    li.appendChild(deleteBtn);

    li.addEventListener("click", () => {
      if (sess.id === activeSessionId) return;
      abortCurrentStream();
      autosaveCurrentSession();
      loadSession(sess);
    });

    sessionListEl.appendChild(li);
  }
}

// ── Init ──
window.addEventListener("DOMContentLoaded", async () => {
  // Initialize or restore session
  if (allSessions.length === 0) {
    const first = createSession();
    loadSession(first);
  } else {
    const lastActive = getActiveSession();
    if (lastActive) {
      loadSession(lastActive);
    } else {
      loadSession(allSessions[0]);
    }
  }

  renderSkills();
  void fetchMcpServers();
  if (conversationHistory.length === 0) {
    appendMessage("assistant", "CATOG desktop agent ready. Connected on AMD MI300X.\n\nI can help you with:\n• Terminal command execution\n• Save automations as reusable skills\n\nWhat would you like to do?");
  }

  const newSessionBtn = document.querySelector("#new-session-btn") as HTMLButtonElement;
  newSessionBtn.addEventListener("click", () => {
    abortCurrentStream();
    autosaveCurrentSession();
    chatLogEl.innerHTML = "";
    conversationHistory = [];
    const fresh = createSession();
    loadSession(fresh);
    appendMessage("assistant", "New session started. What would you like to do?");
    autosaveCurrentSession();
  });

  // Restore saved URLs
  const savedCoderUrl = localStorage.getItem("ai-coder-url");
  const savedVisionUrl = localStorage.getItem("ai-vision-url");
  const savedCoderModel = localStorage.getItem("ai-coder-model");
  const savedVisionModel = localStorage.getItem("ai-vision-model");
  if (savedCoderUrl) (document.querySelector("#ai-coder-url") as HTMLInputElement).value = savedCoderUrl;
  if (savedVisionUrl) (document.querySelector("#ai-vision-url") as HTMLInputElement).value = savedVisionUrl;
  if (savedCoderModel) (document.querySelector("#ai-coder-model") as HTMLInputElement).value = savedCoderModel;
  if (savedVisionModel) (document.querySelector("#ai-vision-model") as HTMLInputElement).value = savedVisionModel;
  (document.querySelector("#telegram-bot-token") as HTMLInputElement).value = TELEGRAM_BOT_TOKEN;
  (document.querySelector("#telegram-chat-id") as HTMLInputElement).value = TELEGRAM_CHAT_ID;
  (document.querySelector("#telegram-enabled") as HTMLInputElement).checked = TELEGRAM_ENABLED;
  restartTelegramPolling();

  // Auto-detect model names from servers if not already saved
  void (async () => {
    try {
      const coderUrl = AI_CODER_URL;
      if (coderUrl) {
        const res = await fetch(`${coderUrl}/v1/models`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const id = data.data?.[0]?.id || "";
          if (id) {
            detectedCoderModel = id;
            const storedCoderModel = localStorage.getItem("ai-coder-model") || "";
            if (!storedCoderModel || isBuiltInDefaultModel(storedCoderModel, "coder")) {
              localStorage.setItem("ai-coder-model", id);
              (document.querySelector("#ai-coder-model") as HTMLInputElement).value = id;
            }
          }
        }
      }
    } catch { /* best effort */ }
    try {
      const visionUrl = AI_VISION_URL;
      if (visionUrl) {
        const res = await fetch(`${visionUrl}/v1/models`).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const id = data.data?.[0]?.id || "";
          if (id) {
            detectedVisionModel = id;
            const storedVisionModel = localStorage.getItem("ai-vision-model") || "";
            if (!storedVisionModel || isBuiltInDefaultModel(storedVisionModel, "vision")) {
              localStorage.setItem("ai-vision-model", id);
              (document.querySelector("#ai-vision-model") as HTMLInputElement).value = id;
            }
          }
        }
      }
    } catch { /* best effort */ }
  })();

  chatFormEl.addEventListener("submit", (e) => { void handleSubmit(e as SubmitEvent); });
  chatSendBtn.addEventListener("click", (e) => {
    if (chatSendBtn.classList.contains("stop")) {
      e.preventDefault();
      e.stopPropagation();
      abortCurrentStream();
    }
  });
  menuToggleEl.addEventListener("click", () => { appShellEl.classList.toggle("threads-collapsed"); });

  // Widget toggles
  btnMcp.addEventListener("click", () => openWidget(mcpWidget));
  btnAi.addEventListener("click", () => openWidget(aiWidget));
  btnTelegram.addEventListener("click", () => openWidget(telegramWidget));
  closeMcp.addEventListener("click", () => closeWidgetFn(mcpWidget));
  closeAi.addEventListener("click", () => closeWidgetFn(aiWidget));
  closeTelegram.addEventListener("click", () => closeWidgetFn(telegramWidget));
  saveMcp.addEventListener("click", handleSaveMcp);
  saveAi.addEventListener("click", () => { void handleSaveAi(); });
  saveTelegram.addEventListener("click", () => { void handleSaveTelegram(); });

  // Skill widget toggles
  btnImportSkill.addEventListener("click", () => openWidget(importSkillWidget));
  btnExportSkill.addEventListener("click", () => { populateExportSkillSelect(); openWidget(exportSkillWidget); });

  // Self-Evolving Engine controls
  const evolveClearBtn = document.getElementById("evolve-clear-memory");
  const evolveToggleBtn = document.getElementById("evolve-toggle");
  if (evolveClearBtn) evolveClearBtn.addEventListener("click", () => { evolveClearMemory(); evolveRatchetLog("neutral", "Memory cleared by user."); });
  if (evolveToggleBtn) evolveToggleBtn.addEventListener("click", evolveToggleEnabled);
  const evolveGradeCorrectBtn = document.getElementById("evolve-grade-correct");
  const evolveGradeIncorrectBtn = document.getElementById("evolve-grade-incorrect");
  if (evolveGradeCorrectBtn) evolveGradeCorrectBtn.addEventListener("click", () => evolveApplyHumanGrade(true));
  if (evolveGradeIncorrectBtn) evolveGradeIncorrectBtn.addEventListener("click", () => evolveApplyHumanGrade(false));
  // Initialize evolve UI on startup
  evolveUpdateUI();
  if (!evolveEnabled) {
    evolveSetStatus("idle", "Disabled");
    const iconEl = document.getElementById("evolve-toggle-icon");
    const labelEl = document.getElementById("evolve-toggle-label");
    if (iconEl) iconEl.textContent = "▶";
    if (labelEl) labelEl.textContent = "Disabled";
  }
  closeImportSkill.addEventListener("click", () => { closeWidgetFn(importSkillWidget); clearImportPreview(); });
  closeExportSkill.addEventListener("click", () => { closeWidgetFn(exportSkillWidget); exportPreview.classList.add("hidden"); exportSkillSelect.value = ""; });
  saveImportSkill.addEventListener("click", handleImportSkill);
  saveExportSkill.addEventListener("click", handleExportSkill);

  // ── Explore Tool (Self-Learning) wiring ──
  const exploreWidget = document.getElementById("explore-tool-widget") as HTMLDivElement | null;
  const btnExplore = document.getElementById("btn-explore-tool");
  const closeExplore = document.getElementById("close-explore-tool");
  if (exploreWidget && btnExplore) {
    btnExplore.addEventListener("click", () => {
      renderExploreProfilesList();
      openWidget(exploreWidget);
      void primeExploreProgramList();
    });
  }
  if (exploreWidget && closeExplore) {
    closeExplore.addEventListener("click", () => closeWidgetFn(exploreWidget));
  }

  const exploreInput = document.getElementById("explore-program-input") as HTMLInputElement | null;
  const exploreList = document.getElementById("explore-program-list") as HTMLDivElement | null;
  if (exploreInput && exploreList) {
    exploreInput.addEventListener("input", () => renderExploreProgramListFiltered(exploreInput.value));
  }

  const exploreStartBtn = document.getElementById("explore-start-btn") as HTMLButtonElement | null;
  const exploreStopBtn = document.getElementById("explore-stop-btn") as HTMLButtonElement | null;
  if (exploreStartBtn) {
    exploreStartBtn.addEventListener("click", () => { void handleExploreStart(); });
  }
  if (exploreStopBtn) {
    exploreStopBtn.addEventListener("click", () => {
      exploreStopFlag = true;
      exploreLogAppend("Stop requested — finishing current iteration…", "warn");
    });
  }

  // Import drag and drop
  importDropZone.addEventListener("click", () => importSkillFile.click());
  importDropZone.addEventListener("dragover", (e) => { e.preventDefault(); importDropZone.classList.add("drag-over"); });
  importDropZone.addEventListener("dragleave", () => { importDropZone.classList.remove("drag-over"); });
  importDropZone.addEventListener("drop", (e) => { e.preventDefault(); importDropZone.classList.remove("drag-over"); const files = e.dataTransfer?.files; if (files && files.length > 0) updateImportPreview(files[0]); });
  importSkillFile.addEventListener("change", () => { if (importSkillFile.files && importSkillFile.files.length > 0) updateImportPreview(importSkillFile.files[0]); });
  importPreviewRemove.addEventListener("click", (e) => { e.stopPropagation(); clearImportPreview(); });

  // Export preview
  exportSkillSelect.addEventListener("change", updateExportPreview);
  exportPreviewCopy.addEventListener("click", () => {
    void navigator.clipboard.writeText(exportPreviewCode.textContent || "").then(() => {
      exportPreviewCopy.textContent = "Copied!";
      setTimeout(() => { exportPreviewCopy.innerHTML = "&#128203; Copy"; }, 2000);
    });
  });

  // Terminal
  closeTerminal.addEventListener("click", exitTerminalMode);
  setupTerminal();

  // Aiz Skill Builder
  btnAizSkill.addEventListener("click", () => {
    aizSkillBackdrop.classList.remove("hidden");
    aizSkillWidget.classList.remove("hidden");
  });
  closeAizSkill.addEventListener("click", () => {
    aizSkillBackdrop.classList.add("hidden");
    aizSkillWidget.classList.add("hidden");
  });
  aizSkillBackdrop.addEventListener("click", (e) => {
    if (e.target === aizSkillBackdrop) {
      aizSkillBackdrop.classList.add("hidden");
      aizSkillWidget.classList.add("hidden");
    }
  });
  setupAizSkillBuilder();
});
