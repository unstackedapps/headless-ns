function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// Default is 1 MB because Ask sends its transcript. File upload passes a larger limit.
export function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(badRequest("The request body is too large."));
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
        reject(badRequest("The body was not JSON."));
      }
    });
    req.on("error", reject);
  });
}

// Returns why a request to /api/ must be refused, or "" when it may run.
// A cross-site form or fetch cannot send application/json without a preflight,
// and the browser always sets Origin on a cross-site POST.
export function blockedReason(req, port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(String(req.headers.host || "").toLowerCase())) return "Open this app at https://localhost.";
  if (req.method === "GET" || req.method === "HEAD") return "";
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return "Send the body as application/json.";
  const origin = req.headers.origin;
  if (origin) return hosts.some((host) => origin === `https://${host}`) ? "" : "Cross-site requests are not allowed.";
  return req.headers["sec-fetch-site"] === "same-origin" ? "" : "Cross-site requests are not allowed.";
}
