import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { knownAccount } from "./env.mjs";

// NetSuite metadata (record types, tables, fields, columns, transforms) changes only when the
// account adds a custom record or field, so it is kept for a day, in memory and in
// data/metadata-<account>.json so a restart starts warm. Refresh on Records or Query clears it.
export const META_TTL_MS = 24 * 60 * 60_000;

const accounts = new Map();
const inflight = new Map();

function fileOf(account) {
  return `data/metadata-${account.replace(/[^A-Za-z0-9_-]/g, "")}.json`;
}

function storeOf(account) {
  if (!accounts.has(account)) {
    let saved = {};
    try {
      if (existsSync(fileOf(account))) saved = JSON.parse(readFileSync(fileOf(account), "utf8"));
    } catch {
      saved = {};
    }
    accounts.set(account, new Map(Object.entries(saved)));
  }
  return accounts.get(account);
}

function save(account, store) {
  try {
    mkdirSync("data", { recursive: true });
    const disk = Object.fromEntries([...store].filter(([, entry]) => entry.disk));
    writeFileSync(`${fileOf(account)}.tmp`, JSON.stringify(disk));
    renameSync(`${fileOf(account)}.tmp`, fileOf(account));
  } catch (error) {
    console.log(`[headless] could not save metadata: ${error.message}`);
  }
}

// Returns the cached value for this account and key, or runs load() once and keeps the result.
// fresh skips the cache. ttl and disk let short-lived values (the signed-in person) stay in memory only.
export async function cachedMeta(key, load, { fresh = false, ttl = META_TTL_MS, disk = true, now = Date.now } = {}) {
  const account = knownAccount() || "default";
  const store = storeOf(account);
  const hit = store.get(key);
  if (!fresh && hit && now() - hit.at < ttl) return hit.value;
  const slot = `${account} ${key}`;
  if (!fresh && inflight.has(slot)) return inflight.get(slot);
  const task = (async () => {
    const value = await load();
    store.set(key, { at: now(), value, disk });
    if (disk) save(account, store);
    return value;
  })().finally(() => inflight.delete(slot));
  inflight.set(slot, task);
  return task;
}

// Drops every cached value whose key starts with prefix ("" drops all), for the current account.
export function clearMeta(prefix = "") {
  const account = knownAccount() || "default";
  const store = storeOf(account);
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
  save(account, store);
}

export function forgetMetaMemory() {
  accounts.clear();
  inflight.clear();
}
