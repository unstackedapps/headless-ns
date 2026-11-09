import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// Saved queries live on the server, in data/queries.json, so the Query page and the
// command line (sql @name) share them.
export const QUERIES_FILE = "data/queries.json";
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const MAX_SAVED = 100;

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function assertReadQuery(sql) {
  const text = String(sql || "").trim();
  if (!text) fail("Write a SELECT first.");
  if (text.length > 4000) fail("That query is too long.");
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").trim();
  const one = stripped.endsWith(";") ? stripped.slice(0, -1).trim() : stripped;
  if (one.includes(";")) fail("Send one statement.");
  if (!/^(select|with)\b/i.test(one) || /\b(insert|update|delete|merge|drop|alter|create|grant|exec)\b/i.test(one)) {
    fail("Only a SELECT can run from here.");
  }
  return one;
}

// NetSuite returns at most 1,000 rows a page and 5,000 rows in all, so pages stop there.
export function queryPage(body) {
  const size = Math.min(1000, Math.max(1, Math.trunc(Number(body?.pageSize)) || 40));
  const page = Math.max(0, Math.trunc(Number(body?.page)) || 0);
  if ((page + 1) * size > 5000) fail("SuiteQL returns at most 5,000 rows. Narrow the query.");
  return { page, size };
}

export function readQueries(file = QUERIES_FILE) {
  try {
    if (!existsSync(file)) return [];
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(saved) ? saved.filter((row) => row && NAME.test(row.name) && typeof row.sql === "string") : [];
  } catch {
    return [];
  }
}

function writeQueries(rows, file) {
  mkdirSync("data", { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(rows, null, 2));
  renameSync(`${file}.tmp`, file);
}

// Saves or replaces a query by name. Names compare without case.
export function saveQuery({ name, sql }, file = QUERIES_FILE) {
  const clean = String(name || "").trim();
  if (!NAME.test(clean)) fail("Name the query with letters, numbers, spaces, dashes or underscores, up to 60.");
  const text = assertReadQuery(sql);
  const rows = readQueries(file).filter((row) => row.name.toLowerCase() !== clean.toLowerCase());
  if (rows.length >= MAX_SAVED) fail(`You can save up to ${MAX_SAVED} queries. Delete one first.`);
  const next = [...rows, { name: clean, sql: text }].sort((a, b) => a.name.localeCompare(b.name));
  writeQueries(next, file);
  return next;
}

export function deleteQuery(name, file = QUERIES_FILE) {
  const clean = String(name || "").trim().toLowerCase();
  const next = readQueries(file).filter((row) => row.name.toLowerCase() !== clean);
  writeQueries(next, file);
  return next;
}

export function findQuery(name, file = QUERIES_FILE) {
  const clean = String(name || "").trim().toLowerCase();
  return readQueries(file).find((row) => row.name.toLowerCase() === clean) || null;
}

export function queryRoutes({ sendJson, authorized, readJsonBody }) {
  return {
    "GET /api/queries": async (req, res) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, { queries: readQueries() });
    },
    "POST /api/queries": async (req, res) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, { queries: saveQuery(await readJsonBody(req)) });
    },
    "POST /api/queries/delete": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, { queries: deleteQuery(body.name) });
    },
  };
}
