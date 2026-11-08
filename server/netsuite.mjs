import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import {
  REDIRECT_URI,
  SCOPES,
  accountHost,
  accountId,
  appOrigin,
  clientId,
  clientSecret,
  suiteTalkHost,
} from "./env.mjs";

let discoveryCache = null;

export function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function pkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function getDiscovery() {
  const id = accountId();
  if (discoveryCache?.accountId === id) {
    const ttl = discoveryCache.jwks?.keys?.length ? 10 * 60 * 1000 : 15 * 1000;
    if (Date.now() - discoveryCache.fetchedAtMs < ttl) return discoveryCache;
  }
  const url = `https://${suiteTalkHost()}/.well-known/openid-configuration`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status}). ${text.slice(0, 180)}`);
  }
  const document = JSON.parse(text);
  let jwks = { keys: [] };
  let jwksError = null;
  try {
    const keysResponse = await fetch(document.jwks_uri);
    const body = await keysResponse.json().catch(() => null);
    if (keysResponse.ok && Array.isArray(body?.keys)) jwks = body;
    else jwksError = body?.error || `Signing keys returned ${keysResponse.status}.`;
  } catch (error) {
    jwksError = error.message;
  }
  discoveryCache = {
    ...document,
    accountId: id,
    jwks,
    jwksError,
    url,
    fetchedAt: new Date().toISOString(),
    fetchedAtMs: Date.now(),
  };
  return discoveryCache;
}

export function publicDiscovery(document) {
  return {
    url: document.url,
    issuer: document.issuer,
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    scopes: document.scopes_supported ?? [],
    fetchedAt: document.fetchedAt,
    signingKeys: document.jwks?.keys?.length ?? 0,
    jwksError: document.jwksError,
  };
}

async function tokenRequest(body, options = {}) {
  const discovery = await getDiscovery();
  const id = options.clientId || clientId();
  const secret = options.clientSecret != null ? options.clientSecret : clientSecret();
  const params = new URLSearchParams(body);
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (secret) headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  else params.set("client_id", id);
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers,
    body: params,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Token request failed (${response.status}).`);
  }
  return payload;
}

export async function authorizationRedirect(state, nonce, challenge, options = {}) {
  const discovery = await getDiscovery();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId || clientId(),
    redirect_uri: REDIRECT_URI,
    scope: options.scope || SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (nonce) params.set("nonce", nonce);
  return `${discovery.authorization_endpoint}?${params}`;
}

export async function exchangeCode(code, verifier, options = {}) {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
    options,
  );
}

export async function refreshTokens(refreshToken, options = {}) {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    options,
  );
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export async function verifyIdToken(idToken, nonce) {
  const discovery = await getDiscovery();
  const [headerPart, payloadPart, signaturePart] = String(idToken || "").split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("NetSuite did not return a readable ID token.");
  }
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  if (header.alg !== "RS256") throw new Error("The ID token algorithm is not RS256.");
  if (payload.iss !== discovery.issuer) throw new Error("The ID token issuer does not match discovery.");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId())) throw new Error("The ID token audience does not match this integration.");
  if (payload.nonce !== nonce) throw new Error("The ID token nonce does not match this sign-in.");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - 60) throw new Error("The ID token has expired.");
  const keys = discovery.jwks?.keys ?? [];
  if (keys.length === 0) return payload;
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("The ID token signing key was not in the published set.");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    key,
    Buffer.from(signaturePart, "base64url"),
  );
  if (!valid) throw new Error("The ID token signature did not verify.");
  return payload;
}

export async function userInfo(accessToken) {
  const discovery = await getDiscovery();
  const response = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || "NetSuite userinfo rejected the access token.");
  }
  return payload;
}

function errorDetail(payload, fallback) {
  const detail = payload?.["o:errorDetails"]?.[0]?.detail;
  return detail || payload?.title || fallback;
}

export async function suiteql(accessToken, query, limit = 100, page = 0) {
  const url = `https://${suiteTalkHost()}/services/rest/query/v1/suiteql?limit=${limit}&offset=${page * limit}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify({ q: query }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(errorDetail(payload, text.slice(0, 300) || `SuiteQL failed (${response.status}).`));
    error.status = response.status;
    throw error;
  }
  return {
    items: payload?.items ?? [],
    hasMore: Boolean(payload?.hasMore),
    total: payload?.totalResults ?? null,
  };
}

export function field(row, name) {
  if (row == null) return null;
  if (row[name] != null) return row[name];
  const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? row[match] : null;
}

export function asNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function recordHref(kind, id) {
  const paths = {
    customer: "/app/common/entity/custjob.nl",
    vendor: "/app/common/entity/vendor.nl",
    salesorder: "/app/accounting/transactions/salesord.nl",
    estimate: "/app/accounting/transactions/estimate.nl",
    invoice: "/app/accounting/transactions/custinvc.nl",
    bill: "/app/accounting/transactions/vendbill.nl",
    item: "/app/common/item/item.nl",
    employee: "/app/common/entity/employee.nl",
  };
  const origin = appOrigin();
  return origin ? `${origin}${paths[kind]}?id=${encodeURIComponent(id)}` : "";
}

const TX_PAGE = {
  CustInvc: "custinvc",
  SalesOrd: "salesord",
  CashSale: "cashsale",
  CustCred: "custcred",
  CustPymt: "custpymt",
  VendBill: "vendbill",
  VendPymt: "vendpymt",
  VendCred: "vendcred",
  ItemShip: "itemship",
  ItemRcpt: "itemrcpt",
  Journal: "journal",
  PurchOrd: "purchord",
  Estimate: "estimate",
  RtnAuth: "rtnauth",
};

export function transactionHref(type, id) {
  // shortcut: a type without its own page opens through transaction.nl
  const page = TX_PAGE[type] || "transaction";
  const origin = appOrigin();
  return origin ? `${origin}/app/accounting/transactions/${page}.nl?id=${encodeURIComponent(id)}` : "";
}

export function likeTerm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 @.&'-]/g, "")
    .slice(0, 60)
    .replace(/'/g, "''");
}

// Builds " AND (LOWER(col) LIKE '%term%' OR ...)" from user text. likeTerm keeps the term inside the quotes.
export function searchAnd(columns, raw) {
  const term = likeTerm(raw);
  if (!term) return "";
  return ` AND (${columns.map((column) => `LOWER(${column}) LIKE '%${term}%'`).join(" OR ")})`;
}

export function accountLabel() {
  return accountId() ? accountHost() : "";
}
