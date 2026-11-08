// The one fetch helper for /api/. The server refuses a write that is not application/json.
export async function api<T>(path: string, init: RequestInit & { signInOn401?: boolean } = {}): Promise<T> {
  const { signInOn401, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(rest.headers as Record<string, string> | undefined) },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && signInOn401) {
    location.hash = "#/setup/netsuite";
    location.reload();
    throw new Error("Sign in with NetSuite.");
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

export function postJson<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  return api<T>(path, { ...init, method: "POST", body: JSON.stringify(body) });
}
