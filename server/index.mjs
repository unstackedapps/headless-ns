import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import https from "node:https";
import { createServer } from "vite";
import {
  PORT,
  REDIRECT_URI,
  accountHost,
  accountId,
  connector,
  customMcpToken,
  customMcpUrl,
  mcpClientId,
  mcpClientSecret,
  mcpSuite,
  netsuiteMcpUrl,
  updateEnv,
  sessionSecret,
  sessionSecretIsEphemeral,
  validAccountId,
} from "./env.mjs";
import { callTool, clearMcpCache, listTools, missingNetSuiteTools, osmcpIdentity, plainConnectionError, suiteqlOsmcp, withAuth, withSource } from "./osmcp.mjs";
import { modelStore } from "./models.mjs";
import { blockedReason, readJsonBody } from "./http.mjs";
import { walkRelated } from "./related.mjs";
import { ITEM_TYPES, PAGE_SIZE, TX_LISTS, itemListSql, itemRecordType, pageOf, txListSql, vendorListSql } from "./lists.mjs";
import { studioRoutes } from "./studio.mjs";
import { cachedMeta } from "./metadata.mjs";
import { assertReadQuery, findQuery, queryPage, queryRoutes } from "./queries.mjs";
import { prefetchMeta } from "./records.mjs";
import {
  accountLabel,
  asNumber,
  authorizationRedirect,
  exchangeCode,
  field,
  getDiscovery,
  pkcePair,
  recordHref,
  transactionHref,
  refreshTokens,
  searchAnd,
} from "./netsuite.mjs";

// A stable secret lets sealed sign-in sessions survive a restart.
if (sessionSecretIsEphemeral()) updateEnv(["SESSION_SECRET"], { SESSION_SECRET: randomBytes(32).toString("base64url") });

const SESSIONS_FILE = "data/sessions.json";
const sessions = new Map();
// SuiteQL matches the bare status letter. 'SalesOrd:C' matches nothing.
const OPEN_ORDER = "('C','G','H')";

function ensureCert() {
  mkdirSync("certs", { recursive: true });
  const key = "certs/localhost-key.pem";
  const cert = "certs/localhost.pem";
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "825",
        "-nodes",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "inherit" },
    );
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function aesKey() {
  return createHash("sha256").update(sessionSecret()).digest();
}

function seal(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function unseal(token) {
  const buf = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", aesKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(json);
}

// Sign-in sessions are kept on disk, sealed with SESSION_SECRET, so a restart keeps users signed in.
function saveSessions() {
  try {
    mkdirSync("data", { recursive: true });
    const tmp = `${SESSIONS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sealed: seal(Object.fromEntries(sessions)) }), { mode: 0o600 });
    renameSync(tmp, SESSIONS_FILE);
  } catch (error) {
    console.log(`[headless] could not save sessions: ${error.message}`);
  }
}

function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    const saved = unseal(JSON.parse(readFileSync(SESSIONS_FILE, "utf8")).sealed);
    for (const [sid, session] of Object.entries(saved)) {
      if (session?.refreshToken || session?.expiresAt > Date.now()) sessions.set(sid, session);
    }
  } catch (error) {
    console.log(`[headless] could not read saved sessions, starting signed out: ${error.message}`);
  }
}

loadSessions();

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, path }) {
  const secure = `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=${path}`;
  return maxAge === 0 ? `${secure}; Max-Age=0` : `${secure}; Max-Age=${maxAge}`;
}

function sendJson(res, status, body, extraCookies = []) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(json),
    ...(extraCookies.length ? { "Set-Cookie": extraCookies } : {}),
  });
  res.end(json);
}

function redirect(res, location, extraCookies = []) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...(extraCookies.length ? { "Set-Cookie": extraCookies } : {}),
  });
  res.end();
}

function meta(session) {
  return {
    fetchedAt: new Date().toISOString(),
    tokenExpiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    source:
      session.via === "custom"
          ? "MCP server"
          : session.via === "netsuite"
            ? "NetSuite MCP"
            : "SuiteTalk",
  };
}

async function ensureFresh(session) {
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) throw new Error("The NetSuite access token expired. Sign in again.");
  const tokens = await refreshTokens(
    session.refreshToken,
    { clientId: mcpClientId(), clientSecret: mcpClientSecret() },
  );
  session.accessToken = tokens.access_token;
  if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
  session.expiresAt = Date.now() + Math.max(30, (tokens.expires_in ?? 3600) - 60) * 1000;
  saveSessions();
  return session;
}

function mcpAuth(session) {
  if (!session?.accessToken) return null;
  return { url: netsuiteMcpUrl(), token: session.accessToken, label: "NetSuite", protocol: "2025-06-18", handshake: true };
}

function hint(value) {
  if (!value) return "";
  return value.length > 8 ? `…${value.slice(-4)}` : "saved";
}

async function authorized(req, res) {
  const kind = connector();
  // These hosts use a token from .env, so there is no browser session to check. The server
  // listens on 127.0.0.1 and handle() refuses cross-site writes; any local process could read .env anyway.
  if (kind === "custom") return { via: kind, expiresAt: 0 };
  const sid = cookies(req).hn_sid;
  const session = sid ? sessions.get(sid) : null;
  if (!session?.mcp) {
    sendJson(res, 401, { error: "Sign in with NetSuite." });
    return null;
  }
  try {
    await ensureFresh(session);
    return { ...session, via: "netsuite" };
  } catch (error) {
    sessions.delete(sid);
    saveSessions();
    sendJson(res, 401, { error: error.message || "The NetSuite session expired. Sign in again." });
    return null;
  }
}

function idOf(row) {
  const id = field(row, "id");
  return id == null || id === "" ? "" : String(id);
}

const queue = [];
let activeQueries = 0;

function schedule(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeQueries += 1;
      task().then(resolve, reject).finally(() => {
        activeQueries -= 1;
        const next = queue.shift();
        if (next) next();
      });
    };
    if (activeQueries < 2) start();
    else queue.push(start);
  });
}

// Every read goes through the MCP connection the request runs under.
function query(_session, sql, limit, source = "ledger", page = 0) {
  return schedule(() => withSource(source, () => suiteqlOsmcp(sql, limit, page)));
}

function rowsOf(result, map) {
  return {
    rows: result.items.map(map).filter((row) => row.id),
    hasMore: result.hasMore,
    total: result.total,
  };
}

function rangeBounds(range) {
  if (range !== "month" && range !== "quarter" && range !== "year") return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let start;
  let end;
  if (range === "month") {
    start = new Date(year, month, 1);
    end = new Date(year, month + 1, 1);
  } else if (range === "quarter") {
    const quarter = Math.floor(month / 3) * 3;
    start = new Date(year, quarter, 1);
    end = new Date(year, quarter + 3, 1);
  } else {
    start = new Date(year, 0, 1);
    end = new Date(year + 1, 0, 1);
  }
  const iso = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

function dateSql(range) {
  const bounds = rangeBounds(range);
  if (!bounds) return "";
  return `trandate >= TO_DATE('${bounds.start}', 'YYYY-MM-DD') AND trandate < TO_DATE('${bounds.end}', 'YYYY-MM-DD')`;
}

async function groupedAmounts(session, where, amountField) {
  try {
    const result = await query(
      session,
      `SELECT BUILTIN.DF(currency) AS currency, COUNT(id) AS n,
              NVL(SUM(${amountField}), 0) AS amount,
              NVL(AVG(${amountField}), 0) AS avgamount,
              NVL(MIN(${amountField}), 0) AS minamount,
              NVL(MAX(${amountField}), 0) AS maxamount
       FROM transaction
       WHERE ${where}
       GROUP BY BUILTIN.DF(currency)`,
      50,
    );
    return {
      rows: result.items.map((row) => ({
        currency: String(field(row, "currency") || ""),
        n: asNumber(field(row, "n")) ?? 0,
        amount: asNumber(field(row, "amount")),
        avg: asNumber(field(row, "avgamount")),
        min: asNumber(field(row, "minamount")),
        max: asNumber(field(row, "maxamount")),
      })),
    };
  } catch (error) {
    console.log(`[headless] currency totals unavailable, counted rows instead: ${error.message}`);
    const result = await query(session, `SELECT COUNT(id) AS n FROM transaction WHERE ${where}`, 1);
    return {
      rows: [{ currency: "", n: asNumber(field(result.items[0], "n")) ?? 0, amount: null, avg: null, min: null, max: null }],
    };
  }
}

async function countOf(session, sql) {
  const result = await query(session, sql, 1);
  return { n: asNumber(field(result.items[0], "n")) ?? 0 };
}

const routes = {
  async session(_req, res) {
    const base = {
      accountId: accountLabel(),
      accountMissing: !accountId(),
      redirectUri: REDIRECT_URI,
      ephemeralSecret: sessionSecretIsEphemeral(),
      ai: modelStore.view().connections.some((row) => row.configured),
    };
    const kind = connector();
    if (kind === "custom") {
      try {
        const identity = await osmcpIdentity();
        void prefetchMeta();
        sendJson(res, 200, {
          ...base,
          accountId: identity.accountId || base.accountId,
          signedIn: true,
          via: kind,
          roleId: identity.roleId,
          email: null,
          expiresAt: null,
          osmcpError: null,
        });
      } catch (error) {
        sendJson(res, 200, {
          ...base,
          signedIn: false,
          via: kind,
          roleId: null,
          email: null,
          expiresAt: null,
          osmcpError: error.message,
        });
      }
      return;
    }
    const sid = cookies(_req).hn_sid;
    const session = sid ? sessions.get(sid) : null;
    if (kind === "netsuite" && session?.mcp) {
      try {
        const identity = await withAuth(mcpAuth(session), () => osmcpIdentity());
        void withAuth(mcpAuth(session), () => prefetchMeta());
        sendJson(res, 200, {
          ...base,
          accountId: identity.accountId || base.accountId,
          signedIn: true,
          via: "netsuite",
          roleId: identity.roleId,
          email: null,
          expiresAt: new Date(session.expiresAt).toISOString(),
          osmcpError: null,
        });
      } catch (error) {
        sendJson(res, 200, {
          ...base,
          signedIn: true,
          via: "netsuite",
          roleId: null,
          email: null,
          expiresAt: new Date(session.expiresAt).toISOString(),
          osmcpError: error.message,
        });
      }
      return;
    }
    sendJson(res, 200, {
      ...base,
      signedIn: false,
      via: kind,
      roleId: null,
      email: null,
      expiresAt: null,
      osmcpError: null,
    });
  },

  async callback(req, res, url) {
    const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (oauthError) {
      redirect(res, "/?auth_error=" + encodeURIComponent(oauthError), [
        cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" }),
      ]);
      return;
    }
    let pending = null;
    try {
      pending = unseal(cookies(req).hn_oauth || "");
    } catch {
      pending = null;
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const company = url.searchParams.get("company");
    if (!pending || pending.flow !== "mcp" || pending.state !== state || !code || Date.now() - pending.created > 10 * 60 * 1000) {
      redirect(res, "/?auth_error=" + encodeURIComponent("This sign-in expired. Start it again."), [
        cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" }),
      ]);
      return;
    }
    if (company && accountHost(company) !== accountHost()) {
      redirect(
        res,
        "/?auth_error=" +
          encodeURIComponent(`NetSuite signed you into ${company}. This app is set to ${accountId()}.`),
        [cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" })],
      );
      return;
    }
    const tokens = await exchangeCode(code, pending.verifier, {
      clientId: mcpClientId(),
      clientSecret: mcpClientSecret(),
    });
    const sid = randomBytes(32).toString("base64url");
    sessions.set(sid, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: Date.now() + Math.max(30, (tokens.expires_in ?? 3600) - 60) * 1000,
      email: "",
      sub: "",
      mcp: true,
    });
    saveSessions();
    redirect(res, "/#/setup/netsuite", [
      cookie("hn_sid", sid, { maxAge: 60 * 60 * 24 * 7, path: "/" }),
      cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" }),
    ]);
  },

  async logout(req, res) {
    const sid = cookies(req).hn_sid;
    if (sid && sessions.delete(sid)) saveSessions();
    sendJson(res, 200, { ok: true }, [cookie("hn_sid", "", { maxAge: 0, path: "/" })]);
  },

  async overview(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const year = new Date().getFullYear();
    const dates = dateSql(String(url?.searchParams.get("range") || "all"));
    const dated = (where) => (dates ? `${where} AND ${dates}` : where);
    const jobs = {
      customers: () => countOf(session, `SELECT COUNT(id) AS n FROM customer WHERE isinactive = 'F'`),
      orders: () =>
        groupedAmounts(
          session,
          dated(`type = 'SalesOrd' AND NVL(voided, 'F') = 'F' AND status NOT IN ${OPEN_ORDER}`),
          "foreigntotal",
        ),
      invoices: () =>
        groupedAmounts(
          session,
          dated(`type = 'CustInvc' AND NVL(voided, 'F') = 'F' AND foreignamountunpaid <> 0`),
          "foreignamountunpaid",
        ),
      bills: () =>
        groupedAmounts(
          session,
          dated(`type = 'VendBill' AND NVL(voided, 'F') = 'F' AND foreignamountunpaid <> 0`),
          "foreignamountunpaid",
        ),
      items: () =>
        countOf(session, `SELECT COUNT(id) AS n FROM item WHERE isinactive = 'F' AND itemtype = 'InvtPart'`),
      people: () => countOf(session, `SELECT COUNT(id) AS n FROM employee WHERE isinactive = 'F'`),
    };
    const metrics = {};
    await Promise.all(
      Object.entries(jobs).map(async ([key, run]) => {
        try {
          metrics[key] = await run();
        } catch (error) {
          metrics[key] = { error: error.message };
        }
      }),
    );
    sendJson(res, 200, { ...meta(session), year, metrics });
  },

  async activity(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const year = new Date().getFullYear();
    const dates = dateSql(String(url?.searchParams.get("range") || "year"));
    const result = await query(
      session,
      `SELECT type AS type, COUNT(id) AS n
       FROM transaction
       ${dates ? `WHERE ${dates}` : ""}
       GROUP BY type
       ORDER BY COUNT(id) DESC`,
      100,
    );
    sendJson(res, 200, {
      ...meta(session),
      year,
      rows: result.items.map((row) => ({
        type: String(field(row, "type") || ""),
        n: asNumber(field(row, "n")) ?? 0,
      })),
    });
  },

  async customers(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const result = await query(
      session,
      `SELECT c.id, c.entityid, c.companyname, c.email, c.phone, BUILTIN.DF(c.subsidiary) AS subsidiary
       FROM customer c
       WHERE c.isinactive = 'F'${searchAnd(["c.entityid", "c.companyname", "c.email"], url.searchParams.get("q"))}
       ORDER BY c.entityid`,
    );
    sendJson(res, 200, {
      ...meta(session),
      ...rowsOf(result, (row) => ({
        id: idOf(row),
        name: field(row, "entityid") || "",
        company: field(row, "companyname") || "",
        email: field(row, "email") || "",
        phone: field(row, "phone") || "",
        subsidiary: field(row, "subsidiary") || "",
        href: recordHref("customer", idOf(row)),
      })),
    });
  },

  async customer(req, res, id) {
    const session = await authorized(req, res);
    if (!session) return;
    const customerResult = await query(
      session,
      `SELECT c.id, c.entityid, c.companyname, c.email, c.phone, BUILTIN.DF(c.subsidiary) AS subsidiary
       FROM customer c
       WHERE c.id = ${id}`,
      1,
    );
    const customerRow = customerResult.items[0];
    if (!customerRow) {
      sendJson(res, 404, { error: "That customer is not in this account." });
      return;
    }
    const [orders, invoices, balances] = await Promise.all([
      query(
        session,
        `SELECT t.id, t.tranid, t.trandate, BUILTIN.DF(t.status) AS status,
                BUILTIN.DF(t.currency) AS currency, t.foreigntotal AS amount
         FROM transaction t
         WHERE t.entity = ${id} AND t.type = 'SalesOrd' AND NVL(t.voided, 'F') = 'F'
           AND t.status NOT IN ${OPEN_ORDER}
         ORDER BY t.trandate DESC`,
        25,
      ),
      query(
        session,
        `SELECT t.id, t.tranid, t.trandate, t.duedate, BUILTIN.DF(t.currency) AS currency,
                t.foreigntotal AS amount, t.foreignamountunpaid AS unpaid
         FROM transaction t
         WHERE t.entity = ${id} AND t.type = 'CustInvc' AND NVL(t.voided, 'F') = 'F'
           AND t.foreignamountunpaid <> 0
         ORDER BY t.duedate`,
        25,
      ),
      query(
        session,
        `SELECT BUILTIN.DF(currency) AS currency, NVL(SUM(foreignamountunpaid), 0) AS amount
         FROM transaction
         WHERE entity = ${id} AND type = 'CustInvc' AND NVL(voided, 'F') = 'F' AND foreignamountunpaid <> 0
         GROUP BY BUILTIN.DF(currency)`,
        20,
      ),
    ]);
    sendJson(res, 200, {
      ...meta(session),
      customer: {
        id,
        name: field(customerRow, "entityid") || "",
        company: field(customerRow, "companyname") || "",
        email: field(customerRow, "email") || "",
        phone: field(customerRow, "phone") || "",
        subsidiary: field(customerRow, "subsidiary") || "",
        href: recordHref("customer", id),
      },
      balance: balances.items.map((row) => ({
        currency: String(field(row, "currency") || ""),
        amount: asNumber(field(row, "amount")),
      })),
      orders: rowsOf(orders, (row) => ({
        id: idOf(row),
        number: field(row, "tranid") || "",
        date: field(row, "trandate") || "",
        status: field(row, "status") || "",
        currency: field(row, "currency") || "",
        amount: asNumber(field(row, "amount")),
        href: recordHref("salesorder", idOf(row)),
      })).rows,
      invoices: rowsOf(invoices, (row) => ({
        id: idOf(row),
        number: field(row, "tranid") || "",
        date: field(row, "trandate") || "",
        due: field(row, "duedate") || "",
        currency: field(row, "currency") || "",
        amount: asNumber(field(row, "amount")),
        unpaid: asNumber(field(row, "unpaid")),
        href: recordHref("invoice", idOf(row)),
      })).rows,
    });
  },

  async items(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const page = pageOf(url.searchParams.get("page"));
    const sql = itemListSql({ type: url.searchParams.get("type"), q: url.searchParams.get("q") });
    const result = await query(session, sql, PAGE_SIZE, "ledger", page);
    let balances = new Map();
    let note = null;
    try {
      const stock = await query(
        session,
        `SELECT item AS item, SUM(quantityonhand) AS onhand, SUM(quantityavailable) AS available
         FROM inventorybalance
         GROUP BY item`,
        1000,
      );
      for (const row of stock.items) {
        balances.set(String(field(row, "item")), {
          onHand: asNumber(field(row, "onhand")),
          available: asNumber(field(row, "available")),
        });
      }
      if (stock.hasMore) note = "Available counts add up only the first 1,000 inventory balances.";
    } catch (error) {
      note = error.message;
    }
    sendJson(res, 200, {
      ...meta(session),
      note,
      page,
      types: Object.entries(ITEM_TYPES).map(([id, spec]) => ({ id, label: spec.label })),
      ...rowsOf(result, (row) => {
        const stock = balances.get(idOf(row));
        const itemType = String(field(row, "itemtype") || "");
        return {
          id: idOf(row),
          name: field(row, "itemid") || "",
          displayName: field(row, "displayname") || "",
          type: ITEM_TYPES[itemType]?.label || itemType,
          recordType: itemRecordType(itemType, field(row, "subtype")),
          onHand: stock?.onHand ?? null,
          available: stock?.available ?? null,
          href: recordHref("item", idOf(row)),
        };
      }),
    });
  },

  async vendors(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const page = pageOf(url.searchParams.get("page"));
    const result = await query(session, vendorListSql(url.searchParams.get("q")), PAGE_SIZE, "ledger", page);
    sendJson(res, 200, {
      ...meta(session),
      page,
      ...rowsOf(result, (row) => ({
        id: idOf(row),
        name: field(row, "entityid") || "",
        company: field(row, "companyname") || "",
        email: field(row, "email") || "",
        phone: field(row, "phone") || "",
        subsidiary: field(row, "subsidiary") || "",
        href: recordHref("vendor", idOf(row)),
      })),
    });
  },

  // Vendor detail: contact fields, open balance, open purchase orders and open bills.
  async vendor(req, res, id) {
    const session = await authorized(req, res);
    if (!session) return;
    const found = await query(
      session,
      `SELECT v.id, v.entityid, v.companyname, v.email, v.phone, BUILTIN.DF(v.subsidiary) AS subsidiary FROM vendor v WHERE v.id = ${id}`,
      1,
    );
    const row = found.items[0];
    if (!row) {
      sendJson(res, 404, { error: "That vendor is not in this account." });
      return;
    }
    const [orders, bills, balances] = await Promise.all([
      query(session, txListSql("purchaseorders", { status: "open", entity: id }), 25),
      query(session, txListSql("bills", { status: "open", entity: id }), 25),
      query(
        session,
        `SELECT BUILTIN.DF(currency) AS currency, NVL(SUM(foreignamountunpaid), 0) AS amount
         FROM transaction
         WHERE entity = ${id} AND type = 'VendBill' AND NVL(voided, 'F') = 'F' AND foreignamountunpaid <> 0
         GROUP BY BUILTIN.DF(currency)`,
        20,
      ),
    ]);
    const tx = (type) => (item) => ({
      id: idOf(item),
      number: field(item, "tranid") || "",
      date: field(item, "trandate") || "",
      due: field(item, "duedate") || "",
      status: String(field(item, "status") || "").replace(/^[^:]*:\s*/, ""),
      currency: field(item, "currency") || "",
      amount: asNumber(field(item, "amount")),
      unpaid: asNumber(field(item, "unpaid")),
      href: transactionHref(type, idOf(item)),
    });
    sendJson(res, 200, {
      ...meta(session),
      vendor: {
        id,
        name: field(row, "entityid") || "",
        company: field(row, "companyname") || "",
        email: field(row, "email") || "",
        phone: field(row, "phone") || "",
        subsidiary: field(row, "subsidiary") || "",
        href: recordHref("vendor", id),
      },
      balance: balances.items.map((item) => ({ currency: String(field(item, "currency") || ""), amount: asNumber(field(item, "amount")) })),
      orders: rowsOf(orders, tx("PurchOrd")).rows,
      bills: rowsOf(bills, tx("VendBill")).rows,
    });
  },

  async employees(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const result = await query(
      session,
      `SELECT id, entityid, title, email, hiredate, issalesrep, BUILTIN.DF(subsidiary) AS subsidiary
       FROM employee
       WHERE isinactive = 'F'${searchAnd(["entityid", "email", "title"], url.searchParams.get("q"))}
       ORDER BY entityid`,
    );
    sendJson(res, 200, {
      ...meta(session),
      ...rowsOf(result, (row) => ({
        id: idOf(row),
        name: field(row, "entityid") || "",
        title: field(row, "title") || "",
        email: field(row, "email") || "",
        hireDate: field(row, "hiredate") || "",
        subsidiary: field(row, "subsidiary") || "",
        salesRep: field(row, "issalesrep") === "T" ? "Yes" : "No",
        href: recordHref("employee", idOf(row)),
      })),
    });
  },

  async me(req, res) {
    const session = await authorized(req, res);
    if (!session) return;
    // The account menu asks on every page load. The person behind a session does not change in a minute.
    sendJson(res, 200, await cachedMeta("me", () => whoAmI(session), { ttl: 60_000, disk: false }));
  },
};

async function whoAmI(session) {
  const identity = await osmcpIdentity().catch(() => null);
  let name = "";
  let email = session.email || "";
  let title = "";
  try {
    const result = await query(
      session,
      `SELECT id, entityid, firstname, lastname, email, title
       FROM employee
       WHERE id IN (BUILTIN.NAMED_GROUP('employee', 'me'))`,
      1,
      "session",
    );
    const row = result.items?.[0];
    if (row) {
      const first = String(field(row, "firstname") || "").trim();
      const last = String(field(row, "lastname") || "").trim();
      name = [first, last].filter(Boolean).join(" ") || String(field(row, "entityid") || "");
      email = String(field(row, "email") || email || "");
      title = String(field(row, "title") || "");
    }
  } catch {
    name = name || email;
  }
  const account = identity?.accountId || accountLabel() || "";
  return {
    name,
    email,
    title,
    accountId: account.toUpperCase(),
    roleId: identity?.roleId || "",
    roleCenter: identity?.roleCenter || "",
  };
}

// One route for every transaction list: ?list=orders&status=open&q=&page=0.
async function txList(req, res, url) {
  const session = await authorized(req, res);
  if (!session) return;
  const name = String(url.searchParams.get("list") || "");
  const sql = txListSql(name, { status: url.searchParams.get("status"), q: url.searchParams.get("q") });
  const spec = TX_LISTS[name];
  const page = pageOf(url.searchParams.get("page"));
  const result = await query(session, sql, PAGE_SIZE, "ledger", page);
  sendJson(res, 200, {
    ...meta(session),
    page,
    statuses: spec.statuses ? Object.entries(spec.statuses).map(([id, label]) => ({ id, label })) : [],
    hasOpen: Boolean(spec.open),
    ...rowsOf(result, (row) => ({
      id: idOf(row),
      number: field(row, "tranid") || "",
      date: field(row, "trandate") || "",
      due: field(row, "duedate") || "",
      name: field(row, "entity") || "",
      status: String(field(row, "status") || "").replace(/^[^:]*:\s*/, ""),
      currency: field(row, "currency") || "",
      amount: asNumber(field(row, "amount")),
      unpaid: asNumber(field(row, "unpaid")),
      href: transactionHref(spec.type, idOf(row)),
    })),
  });
}

const TYPE_LABELS = {
  CustInvc: "Invoice",
  SalesOrd: "Sales order",
  CashSale: "Cash sale",
  CustCred: "Credit memo",
  CustPymt: "Payment",
  VendBill: "Bill",
  VendPymt: "Bill payment",
  VendCred: "Bill credit",
  ItemShip: "Item fulfillment",
  ItemRcpt: "Receipt",
  Journal: "Journal",
  PurchOrd: "Purchase order",
  Estimate: "Estimate",
  RtnAuth: "Return",
};

function typeLabel(type) {
  return TYPE_LABELS[type] || type || "Transaction";
}

function txNode(row, focusId) {
  const id = String(field(row, "id") || "");
  const type = String(field(row, "type") || "");
  return {
    id: `transaction:${id}`,
    label: `${typeLabel(String(field(row, "type") || ""))} ${field(row, "tranid") || id}`.trim(),
    detail: String(field(row, "trandate") || ""),
    focus: id === focusId,
    kind: "transaction",
    recordId: id,
    href: transactionHref(type, id),
  };
}

async function linkRows(session, ids) {
  const list = ids.filter((value) => /^-?\d+$/.test(String(value))).join(",");
  if (!list) return [];
  const where = `previousdoc IN (${list}) OR nextdoc IN (${list})`;
  const line = await query(session, `SELECT DISTINCT previousdoc, nextdoc FROM NextTransactionLineLink WHERE ${where}`, 80, "related");
  const head = await query(session, `SELECT DISTINCT previousdoc, nextdoc FROM NextTransactionLink WHERE ${where}`, 80, "related");
  return [...(line.items || []), ...(head.items || [])];
}

async function relatedGraph(req, res, url) {
  const session = await authorized(req, res);
  if (!session) return;
  const kind = url.searchParams.get("kind") || "";
  const id = String(url.searchParams.get("id") || "");
  if (!["customer", "transaction", "item", "employee"].includes(kind) || !/^-?\d+$/.test(id)) {
    sendJson(res, 400, { error: "Choose a customer, transaction, item, or employee." });
    return;
  }
  const nodes = [];
  const edges = [];
  let txIds = [];

  if (kind === "customer" || kind === "employee") {
    const table = kind === "customer" ? "customer" : "employee";
    const who = await query(session, `SELECT id, entityid FROM ${table} WHERE id = ${id}`, 1, "related");
    const name = field(who.items?.[0], "entityid") || (kind === "customer" ? "Customer" : "Employee");
    nodes.push({
      id: `${kind}:${id}`,
      label: String(name),
      detail: kind === "customer" ? "Customer" : "Employee",
      focus: true,
      kind,
      recordId: id,
      href: recordHref(kind, id),
    });
    const column = kind === "customer" ? "entity" : "employee";
    const txs = await query(
      session,
      `SELECT id, tranid, type, trandate FROM transaction WHERE ${column} = ${id} AND NVL(voided, 'F') = 'F' ORDER BY trandate DESC`,
      24,
      "related",
    );
    for (const row of txs.items || []) {
      const node = txNode(row, "");
      nodes.push(node);
      txIds.push(node.recordId);
    }
  } else if (kind === "item") {
    const item = await query(session, `SELECT id, itemid FROM item WHERE id = ${id}`, 1, "related");
    nodes.push({
      id: `item:${id}`,
      label: String(field(item.items?.[0], "itemid") || "Item"),
      detail: "Item",
      focus: true,
      kind: "item",
      recordId: id,
      href: recordHref("item", id),
    });
    const txs = await query(
      session,
      `SELECT DISTINCT t.id, t.tranid, t.type, t.trandate FROM transaction t INNER JOIN transactionline tl ON tl.transaction = t.id WHERE tl.item = ${id} ORDER BY t.trandate DESC`,
      24,
      "related",
    );
    for (const row of txs.items || []) {
      const node = txNode(row, "");
      nodes.push(node);
      txIds.push(node.recordId);
    }
  } else {
    const walked = await walkRelated(id, (frontier) => linkRows(session, frontier));
    const txs = await query(
      session,
      `SELECT id, tranid, type, trandate FROM transaction WHERE id IN (${walked.ids.join(",")})`,
      40,
      "related",
    );
    for (const row of txs.items || []) {
      const node = txNode(row, id);
      nodes.push(node);
      txIds.push(node.recordId);
    }
    edges.push(...walked.edges);
  }

  if (kind !== "transaction" && txIds.length) {
    const links = await query(
      session,
      `SELECT previousdoc, nextdoc, linktype FROM NextTransactionLink WHERE previousdoc IN (${txIds.join(",")}) OR nextdoc IN (${txIds.join(",")})`,
      80,
      "related",
    );
    const known = new Set(nodes.map((node) => node.id));
    const seen = new Set();
    for (const link of links.items || []) {
      const source = `transaction:${field(link, "previousdoc")}`;
      const target = `transaction:${field(link, "nextdoc")}`;
      if (!known.has(source) || !known.has(target) || seen.has(`${source}>${target}`)) continue;
      seen.add(`${source}>${target}`);
      edges.push({ id: `${source}>${target}`, source, target, label: String(field(link, "linktype") || "") });
    }
    const pointed = new Set(edges.map((edge) => edge.target));
    const root = nodes.find((node) => node.focus);
    if (root) {
      for (const node of nodes) {
        if (node.id === root.id || !node.id.startsWith("transaction:") || pointed.has(node.id)) continue;
        edges.push({ id: `${root.id}>${node.id}`, source: root.id, target: node.id, label: "" });
      }
    }
  }

  sendJson(res, 200, { nodes, edges });
}

async function querySql(req, res) {
  const session = await authorized(req, res);
  if (!session) return;
  const body = await readJsonBody(req);
  // sql @name in the command line runs a saved query.
  const saved = body.name ? findQuery(body.name) : null;
  if (body.name && !saved) {
    sendJson(res, 400, { error: `No saved query is named ${String(body.name).slice(0, 60)}.` });
    return;
  }
  const sql = assertReadQuery(saved ? saved.sql : body.sql);
  const { page, size } = queryPage(body);
  const result = await query(session, sql, size, "query", page);
  const rows = Array.isArray(result.items) ? result.items.slice(0, size) : [];
  sendJson(res, 200, {
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows,
    page,
    total: result.total,
    hasMore: Boolean(result.hasMore),
  });
}

function connectorPayload(req) {
  const sid = cookies(req).hn_sid;
  const session = sid ? sessions.get(sid) : null;
  return {
    kind: connector(),
    accountId: accountId(),
    accountMissing: !accountId(),
    redirectUri: REDIRECT_URI,
    customUrl: customMcpUrl(),
    customHint: hint(customMcpToken()),
    mcpClientId: mcpClientId(),
    mcpSecretHint: hint(mcpClientSecret()),
    mcpConfidential: Boolean(mcpClientSecret()),
    suite: mcpSuite(),
    netsuiteMcpUrl: netsuiteMcpUrl(),
    mcpSignedIn: Boolean(session?.mcp),
  };
}

async function saveConnector(req, res) {
  const body = await readJsonBody(req);
  const kind = String(body.kind || "");
  if (!["netsuite", "custom"].includes(kind)) {
    sendJson(res, 400, { error: "Choose NetSuite OAuth or a custom MCP server." });
    return;
  }
  const customUrl = String(body.customUrl || "").trim();
  if (customUrl && !/^https:\/\//.test(customUrl)) {
    sendJson(res, 400, { error: "The MCP server URL must start with https://." });
    return;
  }
  const nextAccountId = String(body.accountId || "").trim();
  if (nextAccountId && !validAccountId(nextAccountId)) {
    sendJson(res, 400, { error: "The account ID can use letters, numbers, _ and -, up to 40 characters." });
    return;
  }
  // clientType is sent only by setup. Public clears the secret. Confidential needs one.
  const secret = String(body.mcpClientSecret || "");
  if (body.clientType === "confidential" && !secret.trim() && !mcpClientSecret()) {
    sendJson(res, 400, { error: "Add the client secret. A confidential client needs it." });
    return;
  }
  updateEnv(
    ["CONNECTOR", "NETSUITE_ACCOUNT_ID", "MCP_URL", "MCP_TOKEN", "NETSUITE_MCP_CLIENT_ID", "NETSUITE_MCP_CLIENT_SECRET", "NETSUITE_MCP_SUITE"],
    {
      CONNECTOR: kind,
      NETSUITE_ACCOUNT_ID: nextAccountId,
      MCP_URL: customUrl,
      MCP_TOKEN: String(body.customToken || ""),
      NETSUITE_MCP_CLIENT_ID: String(body.mcpClientId || "").trim(),
      NETSUITE_MCP_CLIENT_SECRET: body.clientType === "public" ? null : secret,
      NETSUITE_MCP_SUITE: body.suite === "all" ? "all" : "standard",
    },
  );
  clearMcpCache();
  sendJson(res, 200, connectorPayload(req));
}

// Setup's first step: one identity call and one SuiteQL read must both pass before Next.
async function testConnection(req, res) {
  const session = await authorized(req, res);
  if (!session) return;
  clearMcpCache();
  try {
    const names = (await listTools()).map((tool) => tool.name);
    const missing = missingNetSuiteTools(names);
    if (missing) {
      // OpenSuiteMCP hides the NetSuite tools while its NetSuite login is broken, and says why.
      const status = names.includes("osmcp_connection_status") ? await callTool("osmcp_connection_status", {}).catch(() => null) : null;
      sendJson(res, 400, { error: status?.connected === false && status.remediation ? status.remediation : missing });
      return;
    }
    const identity = await withSource("setup", () => osmcpIdentity());
    const { n } = await countOf(session, `SELECT COUNT(id) AS n FROM customer WHERE isinactive = 'F'`);
    sendJson(res, 200, { accountId: identity.accountId || accountLabel(), roleId: identity.roleId, customers: n });
  } catch (error) {
    sendJson(res, 400, { error: plainConnectionError(error) });
  }
}

async function mcpLogin(_req, res) {
  if (!mcpClientId()) {
    redirect(res, "/?auth_error=" + encodeURIComponent("Add the NetSuite MCP client ID in Settings first."));
    return;
  }
  if (!accountId()) {
    redirect(res, "/?auth_error=" + encodeURIComponent("Add the NetSuite account ID in Settings first."));
    return;
  }
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const location = await authorizationRedirect(state, challenge, {
    clientId: mcpClientId(),
    scope: "mcp",
  });
  redirect(res, location, [
    cookie("hn_oauth", seal({ flow: "mcp", state, verifier, created: Date.now() }), {
      maxAge: 600,
      path: "/api/auth",
    }),
  ]);
}

const apiRoutes = {
  "GET /api/session": routes.session,
  "GET /api/auth/callback": routes.callback,
  "POST /api/auth/logout": routes.logout,
  "GET /api/auth/mcp/login": mcpLogin,
  "GET /api/connector": (req, res) => sendJson(res, 200, connectorPayload(req)),
  "POST /api/config/connector": saveConnector,
  "POST /api/setup/test": testConnection,
  "GET /api/overview": routes.overview,
  "GET /api/activity": routes.activity,
  "GET /api/customers": routes.customers,
  "GET /api/items": routes.items,
  "GET /api/tx": txList,
  "GET /api/vendors": routes.vendors,
  "GET /api/employees": routes.employees,
  "GET /api/me": routes.me,
  "POST /api/query": querySql,
  ...queryRoutes({ sendJson, authorized, readJsonBody }),
  "GET /api/related": (req, res, url) => relatedGraph(req, res, url),
  ...studioRoutes({ sendJson, authorized }),
};

async function handle(req, res, vite) {
  const url = new URL(req.url || "/", "https://localhost");
  const customerMatch = req.method === "GET" ? url.pathname.match(/^\/api\/customers\/(\d{1,12})$/) : null;
  const vendorMatch = req.method === "GET" ? url.pathname.match(/^\/api\/vendors\/(\d{1,12})$/) : null;
  const handler = customerMatch
    ? (request, response) => routes.customer(request, response, customerMatch[1])
    : vendorMatch
      ? (request, response) => routes.vendor(request, response, vendorMatch[1])
      : apiRoutes[`${req.method} ${url.pathname}`];
  if (url.pathname.startsWith("/api/")) {
    const blocked = blockedReason(req, PORT);
    if (blocked) {
      sendJson(res, 403, { error: blocked });
      return;
    }
    if (!handler) {
      sendJson(res, 404, { error: "Unknown API route." });
      return;
    }
    const started = Date.now();
    try {
      await handler(req, res, url);
      console.log(`[headless] ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    } catch (error) {
      const status = error.status === 400 || error.status === 401 ? error.status : 500;
      console.log(`[headless] ${req.method} ${url.pathname} ${status} ${Date.now() - started}ms ${error.message || ""}`);
      if (url.pathname === "/api/auth/callback" && !res.headersSent) {
        redirect(res, "/?auth_error=" + encodeURIComponent(error.message || "Sign-in failed."));
        return;
      }
      if (!res.headersSent) sendJson(res, status, { error: error.message || "The request failed." });
    }
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
}

const tls = ensureCert();
const httpsServer = https.createServer(tls);
const vite = await createServer({
  server: { middlewareMode: true, hmr: { server: httpsServer } },
  appType: "spa",
});

httpsServer.on("request", (req, res) => {
  const run = () => handle(req, res, vite);
  const task = (async () => {
    if (connector() !== "netsuite") return run();
    const sid = cookies(req).hn_sid;
    const session = sid ? sessions.get(sid) : null;
    if (!session?.mcp) return run();
    try {
      await ensureFresh(session);
    } catch {
      return run();
    }
    return withAuth(mcpAuth(session), run);
  })();
  Promise.resolve(task).catch((error) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "The server hit an unexpected error." });
  });
});

httpsServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[headless] https://localhost:${PORT}`);
  console.log(`[headless] redirect ${REDIRECT_URI}`);
  const kind = connector();
  console.log(`[headless] connector ${kind}`);
  if (kind === "custom") {
    osmcpIdentity()
      .then((identity) => {
        console.log(`[headless] ${kind} connected · ${identity.accountId || "account not reported"} · ${identity.roleId}`);
      })
      .catch((error) => {
        console.log(`[headless] ${kind} not ready: ${error.message}`);
      });
  }
  if (!accountId()) return;
  getDiscovery()
    .then(() => console.log(`[headless] NetSuite sign-in ready for ${accountLabel()}`))
    .catch((error) => console.log(`[headless] NetSuite sign-in not ready: ${error.message}`));
});
