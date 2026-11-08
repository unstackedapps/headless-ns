import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import https from "node:https";
import { createServer } from "vite";
import {
  PORT,
  REDIRECT_URI,
  accountHost,
  accountId,
  clientId,
  clientSecret,
  connector,
  customMcpToken,
  customMcpUrl,
  mcpClientId,
  mcpClientSecret,
  mcpSuite,
  netsuiteMcpUrl,
  osmcpToken,
  osmcpUrl,
  updateEnv,
  sessionSecret,
  sessionSecretIsEphemeral,
} from "./env.mjs";
import { clearMcpCache, osmcpIdentity, suiteqlOsmcp, withAuth, withSource } from "./osmcp.mjs";
import { studioRoutes } from "./studio.mjs";
import {
  accountLabel,
  asNumber,
  authorizationRedirect,
  exchangeCode,
  field,
  getDiscovery,
  likeTerm,
  pkcePair,
  publicDiscovery,
  recordHref,
  refreshTokens,
  suiteql,
  userInfo,
  verifyIdToken,
} from "./netsuite.mjs";

const sessions = new Map();
const OPEN_ORDER = "('SalesOrd:C','SalesOrd:G','SalesOrd:H')";

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
      session.via === "opensuitemcp" || session.via === "osmcp"
        ? "OpenSuiteMCP"
        : session.via === "custom"
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
    session.mcp ? { clientId: mcpClientId(), clientSecret: mcpClientSecret() } : {},
  );
  session.accessToken = tokens.access_token;
  if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
  session.expiresAt = Date.now() + Math.max(30, (tokens.expires_in ?? 3600) - 60) * 1000;
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
  if (kind === "opensuitemcp" || kind === "custom") return { via: kind, expiresAt: 0 };
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

async function runQuery(session, sql, limit) {
  try {
    return await suiteql(session.accessToken, sql, limit);
  } catch (error) {
    if (error.status !== 401 || !session.refreshToken) throw error;
    session.expiresAt = 0;
    await ensureFresh(session);
    return suiteql(session.accessToken, sql, limit);
  }
}

function query(session, sql, limit, source = "ledger") {
  if (session.via === "opensuitemcp" || session.via === "osmcp" || session.via === "custom" || session.via === "netsuite") {
    return schedule(() => withSource(source, () => suiteqlOsmcp(sql, limit)));
  }
  return schedule(() => runQuery(session, sql, limit));
}

function searchAnd(columns, raw) {
  const term = likeTerm(raw);
  if (!term) return "";
  return ` AND (${columns.map((column) => `LOWER(${column}) LIKE '%${term}%'`).join(" OR ")})`;
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
    let discovery = null;
    let discoveryError = null;
    try {
      discovery = publicDiscovery(await getDiscovery());
    } catch (error) {
      discoveryError = error.message;
    }
    const base = {
      configured: Boolean(clientId()),
      confidential: Boolean(clientSecret()),
      accountId: accountLabel(),
      redirectUri: REDIRECT_URI,
      scopes: "openid email rest_webservices",
      ephemeralSecret: sessionSecretIsEphemeral(),
      discovery,
      discoveryError,
    };
    const kind = connector();
    if (kind === "opensuitemcp" || kind === "custom") {
      try {
        const identity = await osmcpIdentity();
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
      signedIn: kind === "netsuite" ? false : Boolean(session),
      via: kind === "netsuite" ? "netsuite" : session ? "oidc" : null,
      roleId: null,
      email: session?.email ?? null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      osmcpError: null,
    });
  },

  async login(_req, res) {
    if (!clientId()) {
      redirect(res, "/?auth_error=" + encodeURIComponent("Add NETSUITE_CLIENT_ID to .env before signing in."));
      return;
    }
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const { verifier, challenge } = pkcePair();
    const location = await authorizationRedirect(state, nonce, challenge);
    redirect(res, location, [
      cookie("hn_oauth", seal({ state, nonce, verifier, created: Date.now() }), {
        maxAge: 600,
        path: "/api/auth",
      }),
    ]);
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
    if (!pending || pending.state !== state || !code || Date.now() - pending.created > 10 * 60 * 1000) {
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
    if (pending.flow === "mcp") {
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
      redirect(res, "/#/overview", [
        cookie("hn_sid", sid, { maxAge: 60 * 60 * 24 * 7, path: "/" }),
        cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" }),
      ]);
      return;
    }
    const tokens = await exchangeCode(code, pending.verifier);
    const idToken = await verifyIdToken(tokens.id_token, pending.nonce);
    const profile = await userInfo(tokens.access_token).catch(() => ({}));
    const sid = randomBytes(32).toString("base64url");
    sessions.set(sid, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: Date.now() + Math.max(30, (tokens.expires_in ?? 3600) - 60) * 1000,
      email: profile.email || idToken.email || "",
      sub: idToken.sub,
    });
    redirect(res, "/#/overview", [
      cookie("hn_sid", sid, { maxAge: 60 * 60 * 24 * 7, path: "/" }),
      cookie("hn_oauth", "", { maxAge: 0, path: "/api/auth" }),
    ]);
  },

  async logout(req, res) {
    const sid = cookies(req).hn_sid;
    if (sid) sessions.delete(sid);
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

  async orders(req, res, url) {
    await salesList(req, res, url, {
      type: "SalesOrd",
      where: `NVL(t.voided, 'F') = 'F' AND t.status NOT IN ${OPEN_ORDER}`,
      kind: "salesorder",
    });
  },

  async quotes(req, res, url) {
    await salesList(req, res, url, {
      type: "Estimate",
      where: `NVL(t.voided, 'F') = 'F' AND t.status = 'Estimate:A'`,
      kind: "estimate",
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

  async invoices(req, res, url) {
    await transactionList(req, res, url, "CustInvc", "invoice", "customer");
  },

  async bills(req, res, url) {
    await transactionList(req, res, url, "VendBill", "bill", "vendor");
  },

  async items(req, res, url) {
    const session = await authorized(req, res);
    if (!session) return;
    const result = await query(
      session,
      `SELECT id, itemid, displayname
       FROM item
       WHERE isinactive = 'F' AND itemtype = 'InvtPart'${searchAnd(["itemid", "displayname"], url.searchParams.get("q"))}
       ORDER BY itemid`,
      200,
    );
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
      if (stock.hasMore) note = "Availability is summed from the first 1,000 inventory balances.";
    } catch (error) {
      note = error.message;
    }
    sendJson(res, 200, {
      ...meta(session),
      note,
      ...rowsOf(result, (row) => {
        const stock = balances.get(idOf(row));
        return {
          id: idOf(row),
          name: field(row, "itemid") || "",
          displayName: field(row, "displayname") || "",
          onHand: stock?.onHand ?? null,
          available: stock?.available ?? null,
          href: recordHref("item", idOf(row)),
        };
      }),
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
    sendJson(res, 200, {
      name,
      email,
      title,
      accountId: account.toUpperCase(),
      roleId: identity?.roleId || "",
      roleCenter: identity?.roleCenter || "",
    });
  },
};

async function salesList(req, res, url, { type, where, kind }) {
  const session = await authorized(req, res);
  if (!session) return;
  const term = likeTerm(url.searchParams.get("q"));
  const match = term
    ? ` AND (LOWER(t.tranid) LIKE '%${term}%' OR t.entity IN (SELECT id FROM customer WHERE LOWER(entityid) LIKE '%${term}%' OR LOWER(companyname) LIKE '%${term}%'))`
    : "";
  const result = await query(
    session,
    `SELECT t.id, t.tranid, t.trandate, BUILTIN.DF(t.entity) AS entity, BUILTIN.DF(t.status) AS status,
            BUILTIN.DF(t.currency) AS currency, t.foreigntotal AS amount
     FROM transaction t
     WHERE t.type = '${type}' AND ${where}${match}
     ORDER BY t.trandate DESC`,
  );
  sendJson(res, 200, {
    ...meta(session),
    ...rowsOf(result, (row) => ({
      id: idOf(row),
      number: field(row, "tranid") || "",
      date: field(row, "trandate") || "",
      customer: field(row, "entity") || "",
      status: field(row, "status") || "",
      currency: field(row, "currency") || "",
      amount: asNumber(field(row, "amount")),
      href: recordHref(kind, idOf(row)),
    })),
  });
}

async function transactionList(req, res, url, type, kind, party) {
  const session = await authorized(req, res);
  if (!session) return;
  const term = likeTerm(url.searchParams.get("q"));
  const partyTable = party === "vendor" ? "vendor" : "customer";
  const match = term
    ? ` AND (LOWER(t.tranid) LIKE '%${term}%' OR t.entity IN (SELECT id FROM ${partyTable} WHERE LOWER(entityid) LIKE '%${term}%' OR LOWER(companyname) LIKE '%${term}%'))`
    : "";
  const result = await query(
    session,
    `SELECT t.id, t.tranid, t.trandate, t.duedate, BUILTIN.DF(t.entity) AS entity,
            BUILTIN.DF(t.currency) AS currency, t.foreigntotal AS amount, t.foreignamountunpaid AS unpaid
     FROM transaction t
     WHERE t.type = '${type}' AND NVL(t.voided, 'F') = 'F' AND t.foreignamountunpaid <> 0${match}
     ORDER BY t.duedate`,
  );
  sendJson(res, 200, {
    ...meta(session),
    ...rowsOf(result, (row) => ({
      id: idOf(row),
      number: field(row, "tranid") || "",
      date: field(row, "trandate") || "",
      due: field(row, "duedate") || "",
      name: field(row, "entity") || "",
      currency: field(row, "currency") || "",
      amount: asNumber(field(row, "amount")),
      unpaid: asNumber(field(row, "unpaid")),
      href: recordHref(kind, idOf(row)),
    })),
  });
}

function readJsonBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("The request body is too large.");
        error.status = 400;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        const error = new Error("The body was not JSON.");
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function assertReadQuery(sql) {
  const text = String(sql || "").trim();
  if (!text) {
    const error = new Error("Add a SELECT after sql.");
    error.status = 400;
    throw error;
  }
  if (text.length > 4000) {
    const error = new Error("That query is too long.");
    error.status = 400;
    throw error;
  }
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").trim();
  const one = stripped.endsWith(";") ? stripped.slice(0, -1).trim() : stripped;
  if (one.includes(";")) {
    const error = new Error("Send one statement.");
    error.status = 400;
    throw error;
  }
  if (!/^(select|with)\b/i.test(one) || /\b(insert|update|delete|merge|drop|alter|create|grant|exec)\b/i.test(one)) {
    const error = new Error("Only a SELECT can run from here.");
    error.status = 400;
    throw error;
  }
  return one;
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
  ItemShip: "Fulfillment",
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
  return {
    id: `transaction:${id}`,
    label: `${typeLabel(String(field(row, "type") || ""))} ${field(row, "tranid") || id}`.trim(),
    detail: String(field(row, "trandate") || ""),
    focus: id === focusId,
    kind: "transaction",
    recordId: id,
  };
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
    const links = await query(
      session,
      `SELECT previousdoc, nextdoc, linktype FROM NextTransactionLink WHERE previousdoc = ${id} OR nextdoc = ${id}`,
      40,
      "related",
    );
    const ids = new Set([id]);
    for (const link of links.items || []) {
      ids.add(String(field(link, "previousdoc")));
      ids.add(String(field(link, "nextdoc")));
    }
    const txs = await query(
      session,
      `SELECT id, tranid, type, trandate FROM transaction WHERE id IN (${[...ids].join(",")})`,
      40,
      "related",
    );
    for (const row of txs.items || []) {
      const node = txNode(row, id);
      nodes.push(node);
      txIds.push(node.recordId);
    }
    for (const link of links.items || []) {
      const source = `transaction:${field(link, "previousdoc")}`;
      const target = `transaction:${field(link, "nextdoc")}`;
      edges.push({ id: `${source}>${target}`, source, target, label: String(field(link, "linktype") || "") });
    }
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
  const sql = assertReadQuery(body.sql);
  const result = await query(session, sql, 40, "cli");
  const rows = Array.isArray(result.items) ? result.items.slice(0, 40) : [];
  sendJson(res, 200, {
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows,
    total: result.total,
    hasMore: Boolean(result.hasMore),
  });
}

function connectorPayload(req) {
  const sid = cookies(req).hn_sid;
  const session = sid ? sessions.get(sid) : null;
  return {
    kind: connector(),
    accountId: accountLabel(),
    redirectUri: REDIRECT_URI,
    osmcpUrl: osmcpUrl(),
    osmcpHint: hint(osmcpToken()),
    customUrl: customMcpUrl(),
    customHint: hint(customMcpToken()),
    mcpClientId: mcpClientId(),
    mcpSecretHint: hint(mcpClientSecret()),
    suite: mcpSuite(),
    netsuiteMcpUrl: netsuiteMcpUrl(),
    mcpSignedIn: Boolean(session?.mcp),
  };
}

async function saveConnector(req, res) {
  const body = await readJsonBody(req);
  const kind = String(body.kind || "");
  if (!["opensuitemcp", "netsuite", "custom"].includes(kind)) {
    sendJson(res, 400, { error: "Choose OpenSuiteMCP, NetSuite, or another MCP server." });
    return;
  }
  const customUrl = String(body.customUrl || "").trim();
  const nextOsmcpUrl = String(body.osmcpUrl || "").trim();
  if (customUrl && !/^https:\/\//.test(customUrl)) {
    sendJson(res, 400, { error: "The MCP server URL must start with https://." });
    return;
  }
  if (nextOsmcpUrl && !/^https:\/\//.test(nextOsmcpUrl)) {
    sendJson(res, 400, { error: "The OpenSuiteMCP URL must start with https://." });
    return;
  }
  updateEnv(
    ["CONNECTOR", "OSMCP_URL", "OSMCP_TOKEN", "MCP_URL", "MCP_TOKEN", "NETSUITE_MCP_CLIENT_ID", "NETSUITE_MCP_CLIENT_SECRET", "NETSUITE_MCP_SUITE"],
    {
      CONNECTOR: kind,
      OSMCP_URL: nextOsmcpUrl,
      OSMCP_TOKEN: String(body.osmcpToken || ""),
      MCP_URL: customUrl,
      MCP_TOKEN: String(body.customToken || ""),
      NETSUITE_MCP_CLIENT_ID: String(body.mcpClientId || "").trim(),
      NETSUITE_MCP_CLIENT_SECRET: String(body.mcpClientSecret || ""),
      NETSUITE_MCP_SUITE: body.suite === "all" ? "all" : "standard",
    },
  );
  clearMcpCache();
  sendJson(res, 200, connectorPayload(req));
}

async function mcpLogin(_req, res) {
  if (!mcpClientId()) {
    redirect(res, "/?auth_error=" + encodeURIComponent("Add the NetSuite MCP client ID in Settings first."));
    return;
  }
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const location = await authorizationRedirect(state, "", challenge, {
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
  "GET /api/auth/login": routes.login,
  "GET /api/auth/callback": routes.callback,
  "POST /api/auth/logout": routes.logout,
  "GET /api/auth/mcp/login": mcpLogin,
  "GET /api/connector": (req, res) => sendJson(res, 200, connectorPayload(req)),
  "POST /api/config/connector": saveConnector,
  "GET /api/overview": routes.overview,
  "GET /api/activity": routes.activity,
  "GET /api/customers": routes.customers,
  "GET /api/orders": routes.orders,
  "GET /api/quotes": routes.quotes,
  "GET /api/invoices": routes.invoices,
  "GET /api/bills": routes.bills,
  "GET /api/items": routes.items,
  "GET /api/employees": routes.employees,
  "GET /api/me": routes.me,
  "POST /api/query": querySql,
  "GET /api/related": (req, res, url) => relatedGraph(req, res, url),
  ...studioRoutes({ sendJson, authorized }),
};

async function handle(req, res, vite) {
  const url = new URL(req.url || "/", "https://localhost");
  const customerMatch = req.method === "GET" ? url.pathname.match(/^\/api\/customers\/(\d+)$/) : null;
  const handler = customerMatch
    ? (request, response) => routes.customer(request, response, customerMatch[1])
    : apiRoutes[`${req.method} ${url.pathname}`];
  if (url.pathname.startsWith("/api/")) {
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

httpsServer.listen(PORT, () => {
  console.log(`[headless] https://localhost:${PORT}`);
  console.log(`[headless] redirect ${REDIRECT_URI}`);
  const kind = connector();
  console.log(`[headless] connector ${kind}`);
  if (kind === "opensuitemcp" || kind === "custom") {
    osmcpIdentity()
      .then((identity) => {
        console.log(`[headless] ${kind} connected · ${identity.accountId} · ${identity.roleId}`);
      })
      .catch((error) => {
        console.log(`[headless] ${kind} not ready: ${error.message}`);
      });
  }
  getDiscovery()
    .then((document) => {
      console.log(
        `[headless] OIDC discovery ok for ${accountLabel()} · ${document.jwks.keys.length} signing keys${document.jwksError ? ` · ${document.jwksError}` : ""}`,
      );
    })
    .catch((error) => {
      console.log(`[headless] OIDC discovery failed: ${error.message}`);
    });
});
