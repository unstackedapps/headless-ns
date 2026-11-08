import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const file = "data/policy.json";

export function readPolicy() {
  if (!existsSync(file)) return { allowWrites: false, disabled: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      allowWrites: Boolean(parsed.allowWrites),
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled.map(String) : [],
    };
  } catch {
    return { allowWrites: false, disabled: [] };
  }
}

export function writePolicy(policy) {
  mkdirSync("data", { recursive: true });
  const next = {
    allowWrites: Boolean(policy.allowWrites),
    disabled: Array.isArray(policy.disabled) ? policy.disabled.map(String).slice(0, 80) : [],
  };
  writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}
