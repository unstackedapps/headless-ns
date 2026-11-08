import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";

// Signs the test browser in with the session the dev server saved in data/sessions.json.
// Sign in once in a normal browser first. Nothing here prints or stores the session.
export async function signIn(context: BrowserContext) {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
  const key = createHash("sha256").update(env.SESSION_SECRET).digest();
  const sealed = Buffer.from(JSON.parse(readFileSync("data/sessions.json", "utf8")).sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const sessions = JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8"));
  const sid = Object.entries(sessions).find(([, session]) => (session as { mcp?: unknown })?.mcp)?.[0];
  if (!sid) throw new Error("No signed-in session in data/sessions.json. Sign in at https://localhost:5173 first.");
  await context.addCookies([{ name: "hn_sid", value: sid, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
}
