const entries = [];
let seq = 1;

export function recordTrace(entry) {
  entries.unshift({
    id: seq++,
    at: new Date().toISOString(),
    source: entry.source || "app",
    name: entry.name,
    ms: entry.ms,
    ok: entry.ok,
    detail: String(entry.detail || "").slice(0, 240),
  });
  if (entries.length > 100) entries.pop();
}

export function listTrace() {
  return entries;
}
