import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// Fetches one folder of a public repo at one commit, without a shell, prompts, symlinks or non-https remotes.

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const SAFETY = ["-c", "core.symlinks=false", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.hooksPath=/dev/null"];

// The default runner. Tests pass their own to reach a local repo, since file:// is blocked here.
export function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...SAFETY, ...args],
      { cwd, timeout: 120_000, maxBuffer: 32_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (error.code === "ENOENT") return reject(fail("Git isn't installed or isn't on the PATH. Install git to import from a URL."));
        if (error.killed) return reject(fail("Git took over 2 minutes. Try a smaller folder."));
        reject(fail(String(stderr || error.message).trim().split("\n").at(-1).slice(0, 300) || "Git failed."));
      },
    );
  });
}

const REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

// Splits a URL, ref and folder. A GitHub /tree/<ref>/<folder> URL fills in the ref and folder.
export function parseGitSource({ url, ref, path }, { schemes = ["https:"] } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    throw fail("Enter a Git URL that starts with https://.");
  }
  if (!schemes.includes(parsed.protocol)) throw fail("Enter a Git URL that starts with https://.");
  if (parsed.username || parsed.password) throw fail("Leave the user name and password out of the URL. Only public repos can be imported.");
  let cleanRef = String(ref || "").trim();
  let cleanPath = String(path || "").trim().replace(/^\/+|\/+$/g, "");
  const tree = parsed.hostname === "github.com" && /^\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/.exec(parsed.pathname.replace(/\/$/, ""));
  if (tree) {
    parsed.pathname = `/${tree[1]}/${tree[2]}`;
    cleanRef ||= decodeURIComponent(tree[3]);
    cleanPath ||= decodeURIComponent(tree[4] || "");
  }
  parsed.search = "";
  parsed.hash = "";
  if (!cleanRef) cleanRef = "HEAD";
  if (!REF.test(cleanRef)) throw fail("The branch, tag or commit has characters Git doesn't allow.");
  if (cleanPath && (cleanPath.length > 240 || cleanPath.split("/").some((part) => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(cleanPath))) {
    throw fail("The folder must be a plain path inside the repo, such as anthropic/netsuite-suiteskills.");
  }
  return { url: parsed.href.replace(/\/$/, ""), ref: cleanRef, path: cleanPath };
}

// A ref to a full commit SHA. Branches win over tags, and an annotated tag gives its commit.
export async function resolveRef({ url, ref }, git = runGit) {
  if (SHA.test(ref)) return ref;
  const lines = String(await git(["ls-remote", "--", url, ref, `${ref}^{}`])).trim().split("\n").filter(Boolean);
  const refs = Object.fromEntries(lines.map((line) => line.split("\t").reverse()));
  const sha = refs[ref] || refs[`refs/heads/${ref}`] || refs[`refs/tags/${ref}^{}`] || refs[`refs/tags/${ref}`];
  if (!sha || !SHA.test(sha)) throw fail(`Can't find ${ref} in ${url}.`);
  return sha;
}

// Checks out `path` at `sha` into `dir` and returns its regular files as { path, bytes }, with repo-relative paths.
// Symlinks (mode 120000) and submodules (160000) are dropped and listed.
export async function fetchFolder({ url, sha, path }, dir, { git = runGit, maxFiles, maxBytes }) {
  await git(["init", "-q", dir]);
  await git(["remote", "add", "origin", url], dir);
  try {
    await git(["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", sha], dir);
  } catch (error) {
    throw fail(`Can't fetch ${sha.slice(0, 7)} from ${url}. ${error.message}`);
  }
  if (path) await git(["sparse-checkout", "set", "--no-cone", `/${path}/`], dir);
  // No -l here: sizes would make a partial clone download every blob one by one.
  const listing = String(await git(["ls-tree", "-r", "-z", "FETCH_HEAD", "--", ...(path ? [path] : [])], dir));
  const entries = listing.split("\0").filter(Boolean).map((line) => {
    const [meta, file] = line.split("\t");
    return { mode: meta.split(" ")[0], path: file };
  });
  if (!entries.length) throw fail(path ? `There's no folder ${path} at ${sha.slice(0, 7)}.` : "The repo is empty.");
  const blobs = entries.filter((entry) => entry.mode === "100644" || entry.mode === "100755");
  if (blobs.length > maxFiles) throw fail(`The folder has ${blobs.length} files. The limit is ${maxFiles}.`);
  await git(["checkout", "-q", "FETCH_HEAD"], dir);
  const root = join(dir, "");
  const files = [];
  let total = 0;
  for (const entry of blobs) {
    const full = join(dir, entry.path);
    if (!full.startsWith(root.endsWith(sep) ? root : root + sep) || !existsSync(full)) continue;
    total += statSync(full).size;
    if (total > maxBytes) throw fail("The folder is over 60 MB.");
    files.push({ path: entry.path, bytes: readFileSync(full) });
  }
  const skipped = entries
    .filter((entry) => !blobs.includes(entry))
    .map((entry) => ({ path: entry.path, reason: entry.mode === "120000" ? "Symbolic link" : entry.mode === "160000" ? "Submodule" : "Not a regular file" }));
  return { files, skipped };
}
