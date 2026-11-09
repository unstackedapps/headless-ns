import { createHash, randomBytes } from "node:crypto";
import {
  REDIRECT_URI,
  accountHost,
  accountId,
  appOrigin,
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

// NetSuite's sign-in and token addresses for this account, kept for 10 minutes.
export async function getDiscovery() {
  const id = accountId();
  if (discoveryCache?.accountId === id && Date.now() - discoveryCache.fetchedAtMs < 10 * 60 * 1000) return discoveryCache;
  const url = `https://${suiteTalkHost()}/.well-known/openid-configuration`;
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NetSuite did not return its sign-in addresses (${response.status}). Check the account ID. ${text.slice(0, 180)}`);
  }
  discoveryCache = { ...JSON.parse(text), accountId: id, fetchedAtMs: Date.now() };
  return discoveryCache;
}

async function tokenRequest(body, options = {}) {
  const discovery = await getDiscovery();
  const id = options.clientId;
  const secret = options.clientSecret || "";
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

export async function authorizationRedirect(state, challenge, options) {
  const discovery = await getDiscovery();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: REDIRECT_URI,
    scope: options.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
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
