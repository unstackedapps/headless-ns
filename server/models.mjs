import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.2", needsBaseUrl: false },
  { id: "anthropic", label: "Claude", defaultModel: "claude-sonnet-5-5", needsBaseUrl: false },
  { id: "google", label: "Gemini", defaultModel: "gemini-4-argon", needsBaseUrl: false },
  { id: "xai", label: "Grok", defaultModel: "grok-4.7", needsBaseUrl: false },
  { id: "groq", label: "Groq", defaultModel: "llama-3.1-8b-instant", needsBaseUrl: false },
  { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest", needsBaseUrl: false },
  { id: "compatible", label: "OpenAI-compatible", defaultModel: "", needsBaseUrl: true },
];

const providerIds = new Set(PROVIDERS.map((item) => item.id));

export function providerById(id) {
  return PROVIDERS.find((item) => item.id === id) || null;
}

export function redactKey(key) {
  const value = String(key || "");
  if (!value) return "";
  const tail = value.length >= 8 ? value.slice(-4) : "";
  return `••••••••${tail}`;
}

export function keepsExistingKey(value, currentKey) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (currentKey && text === redactKey(currentKey)) return true;
  return /^•+$/.test(text);
}

function emptyStore() {
  return { activeId: null, connections: [] };
}

function seedFromEnv() {
  const model = process.env.LLM_MODEL?.trim() || "";
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "").replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY?.trim() || "";
  if (!model && !baseUrl && !apiKey) return emptyStore();
  const official = !baseUrl || baseUrl === "https://api.openai.com/v1";
  const provider = official ? "openai" : "compatible";
  const spec = providerById(provider);
  const row = {
    id: randomBytes(8).toString("hex"),
    label: spec.label,
    provider,
    model: model || spec.defaultModel,
    baseUrl: provider === "compatible" ? baseUrl : "",
    apiKey,
  };
  return { activeId: row.id, connections: [row] };
}

function normalize(parsed) {
  const connections = Array.isArray(parsed?.connections) ? parsed.connections.filter((row) => row && providerIds.has(row.provider)) : [];
  const clean = connections.slice(0, 12).map((row) => ({
    id: String(row.id || randomBytes(8).toString("hex")),
    label: String(row.label || providerById(row.provider).label).slice(0, 60),
    provider: row.provider,
    model: String(row.model || "").slice(0, 120),
    baseUrl: String(row.baseUrl || "").replace(/\/$/, "").slice(0, 300),
    apiKey: String(row.apiKey || ""),
  }));
  const activeId = clean.some((row) => row.id === parsed?.activeId) ? parsed.activeId : clean[0]?.id || null;
  return { activeId, connections: clean };
}

export function publicConnection(row) {
  if (!row) return null;
  const spec = providerById(row.provider);
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    providerLabel: spec?.label || row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    configured: Boolean(row.apiKey),
    keyMask: redactKey(row.apiKey),
  };
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function openModelStore(file, { seed = true } = {}) {
  function persist(store) {
    mkdirSync(dirname(file), { recursive: true });
    const next = normalize(store);
    writeFileSync(file, JSON.stringify(next, null, 2));
    return next;
  }

  function read() {
    if (!existsSync(file)) {
      if (!seed) return emptyStore();
      const seeded = seedFromEnv();
      if (seeded.connections.length) return persist(seeded);
      return emptyStore();
    }
    try {
      return normalize(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return emptyStore();
    }
  }

  function view(store = read()) {
    return {
      activeId: store.activeId,
      providers: PROVIDERS.map(({ id, label, defaultModel, needsBaseUrl }) => ({ id, label, defaultModel, needsBaseUrl })),
      connections: store.connections.map(publicConnection),
    };
  }

  function find(store, id) {
    return store.connections.find((row) => row.id === id) || null;
  }

  // The provider, URL, and key to use. A blank key reuses the key saved for the same provider and URL.
  function credentials(store, input) {
    const provider = String(input.provider || "");
    const spec = providerById(provider);
    if (!spec) fail(400, "Choose a model provider.");
    const baseUrl = spec.needsBaseUrl ? String(input.baseUrl || "").trim().replace(/\/$/, "") : "";
    if (spec.needsBaseUrl && !/^https?:\/\//.test(baseUrl)) fail(400, "The provider URL must start with http:// or https://.");
    const current = input.id ? find(store, String(input.id)) : null;
    if (input.id && !current) fail(400, "That model is no longer saved.");
    const twin = current || store.connections.find((row) => row.provider === provider && row.baseUrl === baseUrl);
    const submitted = String(input.apiKey || "");
    const apiKey = keepsExistingKey(submitted, twin?.apiKey) ? twin?.apiKey || "" : submitted.trim();
    if (!apiKey) fail(400, "Add an API key.");
    return { spec, provider, baseUrl, apiKey, current };
  }

  function validate(store, input) {
    const { spec, provider, baseUrl, apiKey, current } = credentials(store, input);
    const model = String(input.model || "").trim().slice(0, 120);
    if (!model) fail(400, "Choose a model.");
    const same = current || store.connections.find((row) => row.provider === provider && row.baseUrl === baseUrl && row.model === model);
    const label = String(input.label || same?.label || spec.label).trim().slice(0, 60) || spec.label;
    return { id: same?.id || randomBytes(8).toString("hex"), label, provider, model, baseUrl, apiKey };
  }

  return {
    read,
    view,
    // A connection checked but not saved, for a test before Finish.
    draft(input) {
      return validate(read(), input);
    },
    credentials(input) {
      const { provider, baseUrl, apiKey } = credentials(read(), input);
      return { provider, baseUrl, apiKey };
    },
    save(input, { activate = false } = {}) {
      const store = read();
      const row = validate(store, input);
      const existing = find(store, row.id);
      if (!existing && store.connections.length >= 12) fail(400, "Twelve models are saved. Remove one before adding another.");
      // One key per provider and URL, as setup shows it, so a new key reaches every model saved with the old one.
      const rekeyed = store.connections.map((item) => (item.provider === row.provider && item.baseUrl === row.baseUrl ? { ...item, apiKey: row.apiKey } : item));
      const connections = existing ? rekeyed.map((item) => (item.id === row.id ? row : item)) : [...rekeyed, row];
      const keep = !activate && store.activeId && connections.some((item) => item.id === store.activeId);
      return view(persist({ activeId: keep ? store.activeId : row.id, connections }));
    },
    activate(id) {
      const store = read();
      if (!find(store, String(id || ""))) fail(400, "Choose a saved model.");
      return view(persist({ ...store, activeId: String(id) }));
    },
    remove(id) {
      const store = read();
      const connections = store.connections.filter((row) => row.id !== id);
      const activeId = store.activeId === id ? connections[0]?.id || null : store.activeId;
      return view(persist({ activeId, connections }));
    },
    require(id) {
      const store = read();
      const row = id ? find(store, String(id)) : find(store, store.activeId);
      if (!row) fail(400, "Add a model under Settings.");
      if (!row.apiKey) fail(400, "This model has no key yet. Add one under Settings.");
      return row;
    },
  };
}

export const modelStore = openModelStore("data/models.json");
