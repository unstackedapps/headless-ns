import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, sep } from "node:path";
import { readFrontmatter } from "./frontmatter.mjs";
import { fetchFolder, parseGitSource, resolveRef, runGit } from "./git.mjs";
import { readZip } from "./zip.mjs";

export const LIMITS = {
  file: 4_000_000,
  image: 1_000_000,
  skill: 20_000_000,
  total: 60_000_000,
  files: 2500,
  skills: 200,
  path: 240,
  staleMs: 30 * 60_000,
};

const TEXT = new Set([".md", ".mdc", ".txt", ".json", ".yaml", ".yml", ".csv", ".sql", ".xml", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".py", ".sh"]);
const IMAGES = new Set([".png", ".svg", ".jpg"]);
const KNOWN_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Returns why a relative path from an upload, zip or git tree is unsafe, or "".
export function pathProblem(rel) {
  const path = String(rel);
  if (!path) return "The path is empty.";
  if (path.length > LIMITS.path) return "The path is over 240 characters.";
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return "The path has a backslash or a control character.";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "The path is absolute.";
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return "The path has an empty, . or .. part.";
  return "";
}

const isHidden = (path) => path.split("/").some((part) => part.startsWith("."));

// Why Ask can't keep this file, or "".
function fileProblem(path, bytes) {
  const ext = extname(path).toLowerCase();
  if (IMAGES.has(ext)) return bytes.length > LIMITS.image ? "Image over 1 MB" : "";
  if (!TEXT.has(ext)) return "File type Ask can't use";
  if (bytes.length > LIMITS.file) return "File over 4 MB";
  try {
    utf8.decode(bytes);
  } catch {
    return "Not UTF-8 text";
  }
  return "";
}

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");

// Checks a SKILL.md header. Returns the facts the preview and index need.
export function checkSkill(text, folder) {
  const parsed = readFrontmatter(text);
  if (!parsed) throw fail("SKILL.md has no frontmatter. It must start with ---.");
  const { data } = parsed;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw fail("The frontmatter has no name.");
  if (name.length > 64 || !NAME.test(name)) throw fail(`The name "${name.slice(0, 80)}" must be 1 to 64 lowercase letters, digits and single hyphens.`);
  const description = typeof data.description === "string" ? data.description.trim() : "";
  if (!description) throw fail("The frontmatter has no description.");
  if (description.length > 1024) throw fail("The description is over 1,024 characters.");
  if (data.compatibility !== undefined && String(data.compatibility).length > 500) throw fail("compatibility is over 500 characters.");
  if (data.metadata !== undefined && (typeof data.metadata !== "object" || Array.isArray(data.metadata))) throw fail("metadata must be a map.");
  const warnings = [];
  if (folder && folder !== name) warnings.push(`The folder is "${folder}" but the skill is named "${name}". Ask uses "${name}".`);
  return {
    name,
    description,
    license: typeof data.license === "string" ? data.license.trim() : "",
    compatibility: typeof data.compatibility === "string" ? data.compatibility : "",
    metadata: data.metadata || {},
    ignoredKeys: Object.keys(data).filter((key) => !KNOWN_KEYS.has(key)),
    warnings,
  };
}

// Wraps one Markdown file (AGENTS.md, CLAUDE.md, a .mdc rule or any playbook) as a one-file skill.
export function wrapPlaybook(path, bytes, { name, description } = {}) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw fail(`${path} is not UTF-8 text.`);
  }
  let parsed = null;
  try {
    parsed = readFrontmatter(text);
  } catch {
    parsed = null;
  }
  const body = (parsed ? parsed.body : text).trim();
  const parts = path.split("/");
  const file = parts.at(-1).replace(/\.(md|mdc)$/i, "");
  const generic = /^(agents|claude|readme|skill)$/i.test(file) && parts.length > 1;
  const finalName = slug(name || (generic ? parts.at(-2) : file)) || "playbook";
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith("#"));
  const finalDescription = String(description || parsed?.data?.description || firstParagraph || `Playbook from ${parts.at(-1)}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1024);
  const skill = `---\nname: ${finalName}\ndescription: ${JSON.stringify(finalDescription)}\n---\n\n${body}\n`;
  return { path: `${finalName}/SKILL.md`, bytes: Buffer.from(skill) };
}

// Groups uploaded files into skills. `files` is [{ path, bytes }] with paths relative to the upload.
export function findSkills(files, { playbook } = {}) {
  let total = 0;
  for (const file of files) {
    const problem = pathProblem(file.path);
    if (problem) throw fail(`${String(file.path).slice(0, 120)}: ${problem}`);
    total += file.bytes.length;
  }
  if (files.length > LIMITS.files) throw fail(`The import has ${files.length} files. The limit is ${LIMITS.files}.`);
  if (total > LIMITS.total) throw fail("The import is over 60 MB unpacked.");
  const usable = files.filter((file) => !file.path.split("/").some((part) => part === ".git" || part === ".DS_Store"));
  let roots = usable
    .filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"))
    .map((file) => file.path.slice(0, -"SKILL.md".length).replace(/\/$/, ""))
    .sort((a, b) => a.length - b.length);
  // A SKILL.md inside another skill is just one of that skill's files.
  roots = roots.filter((root, index) => !roots.slice(0, index).some((outer) => outer === "" || root.startsWith(`${outer}/`)));
  if (!roots.length) {
    const markdown = usable.filter((file) => /\.(md|mdc)$/i.test(file.path) && !isHidden(file.path));
    if (markdown.length !== 1) throw fail("No SKILL.md found. Import a skill folder, a plugin, or one Markdown file.");
    const wrapped = wrapPlaybook(markdown[0].path, markdown[0].bytes, playbook);
    return findSkills([wrapped]);
  }
  const skills = [];
  const skipped = [];
  const claimed = new Set();
  for (const root of roots) {
    const prefix = root ? `${root}/` : "";
    const kept = [];
    for (const file of usable) {
      if (!file.path.startsWith(prefix)) continue;
      claimed.add(file.path);
      const rel = file.path.slice(prefix.length);
      const problem = isHidden(rel) ? "Hidden file" : fileProblem(rel, file.bytes);
      if (problem) skipped.push({ path: file.path, reason: problem });
      else kept.push({ path: rel, bytes: file.bytes });
    }
    skills.push({ root, folder: root.split("/").at(-1) || "", files: kept });
  }
  for (const file of files) if (!claimed.has(file.path)) skipped.push({ path: file.path, reason: "Not inside a skill folder" });
  return { skills, skipped };
}

export const PAGE_CHARS = 12_000;
const SCRIPTS = new Set([".py", ".sh"]);
const SCRIPT_NOTE = "Ask can't run this script. Use it as a description of the steps.";

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens.
const anchorOf = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");

// The lines under `#anchor`, up to the next heading at the same or a higher level. Null when absent.
export function sectionOf(text, anchor) {
  const lines = text.split("\n");
  let fence = false;
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(```|~~~)/.test(lines[index])) fence = !fence;
    const match = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[index]);
    if (!match) continue;
    if (start >= 0 && match[1].length <= level) return lines.slice(start, index).join("\n").trimEnd();
    if (start < 0 && anchorOf(match[2]) === anchor.toLowerCase()) {
      start = index;
      level = match[1].length;
    }
  }
  return start >= 0 ? lines.slice(start).join("\n").trimEnd() : null;
}

// Rewrites relative Markdown links to paths from the skill root, so the model can pass them straight back.
export function rewriteLinks(text, file) {
  const dir = posix.dirname(file);
  return text.replace(/\]\(([^()\s]+)\)/g, (whole, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) return whole;
    const [path, anchor] = target.split("#");
    const resolved = path ? posix.normalize(posix.join(dir, path)) : file;
    if (resolved.startsWith("../") || resolved === "..") return whole;
    return `](${resolved}${anchor !== undefined ? `#${anchor}` : ""})`;
  });
}

// Splits text into pages whose JSON form stays under PAGE_CHARS, so the 14,000-character tool result cap never cuts one.
export function pagesOf(text, size = PAGE_CHARS) {
  const cost = (part) => JSON.stringify(part).length - 2;
  const pages = [];
  let current = "";
  let used = 0;
  const flush = () => {
    if (current) pages.push(current);
    current = "";
    used = 0;
  };
  for (const line of text.split(/(?<=\n)/)) {
    let rest = line;
    // A line longer than a page (a minified JSON file) is cut by length, shrinking until its escaped form fits.
    while (cost(rest) > size) {
      flush();
      let cut = size;
      while (cost(rest.slice(0, cut)) > size) cut = Math.floor((cut * size) / cost(rest.slice(0, cut))) - 1;
      pages.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const more = cost(rest);
    if (used + more > size) flush();
    current += rest;
    used += more;
  }
  flush();
  return pages.length ? pages : [""];
}

// One line per top-level file, and one per folder with its file count, so a 300-file skill lists in a few lines.
function outline(files, folder = "") {
  const prefix = folder ? `${folder}/` : "";
  const entries = new Map();
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) entries.set(rest, { path: prefix + rest, size: file.size });
    else {
      const key = `${rest.slice(0, slash)}/`;
      const entry = entries.get(key) || { path: prefix + key, files: 0 };
      entry.files += 1;
      entries.set(key, entry);
    }
  }
  const rank = (entry) => (entry.path === "SKILL.md" ? 0 : 1);
  return [...entries.values()].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

// Unpacks an uploaded zip with the import limits. Returns { files, skipped } for stage().
export function unzipSkills(buffer) {
  return readZip(buffer, { fileLimit: LIMITS.file, totalLimit: LIMITS.total, maxEntries: LIMITS.files });
}

function digest(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${createHash("sha256").update(file.bytes).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

// Writes a file under root without following links or overwriting, and refuses to leave root.
function writeInside(root, rel, bytes) {
  const target = join(root, rel);
  if (!target.startsWith(root + sep)) throw fail(`${rel}: The path leaves the folder.`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: "wx" });
}

// Throws when a folder holds anything that is not a plain file or folder.
function assertPlainTree(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = lstatSync(full);
    if (info.isDirectory()) assertPlainTree(full);
    else if (!info.isFile()) throw fail(`${entry} is not a plain file.`);
  }
}

function cleanSource(source) {
  const kind = ["folder", "zip", "markdown", "git"].includes(source?.kind) ? source.kind : "folder";
  if (kind !== "git") return { kind };
  return { kind, url: String(source.url), ref: String(source.ref || ""), sha: String(source.sha), path: String(source.path || "") };
}

// `git` and `schemes` are for tests, which fetch from a local repo.
export function openSkillStore(dataDir, { git = runGit, schemes = ["https:"] } = {}) {
  const indexFile = join(dataDir, "skills.json");
  const skillsDir = join(dataDir, "skills");
  const stagingDir = join(skillsDir, ".staging");

  function list() {
    if (!existsSync(indexFile)) return [];
    try {
      const rows = JSON.parse(readFileSync(indexFile, "utf8"));
      return Array.isArray(rows) ? rows.filter((row) => row && NAME.test(String(row.name))) : [];
    } catch {
      return [];
    }
  }

  function save(rows) {
    mkdirSync(dataDir, { recursive: true });
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(indexFile, JSON.stringify(sorted, null, 2));
    return sorted;
  }

  function find(name) {
    const row = list().find((item) => item.name === String(name || ""));
    if (!row) throw fail(`No skill named ${String(name || "").slice(0, 80)}.`);
    return row;
  }

  function sweepStaging() {
    if (!existsSync(stagingDir)) return;
    const cutoff = Date.now() - LIMITS.staleMs;
    for (const entry of readdirSync(stagingDir)) {
      const full = join(stagingDir, entry);
      if (statSync(full).mtimeMs < cutoff) rmSync(full, { recursive: true, force: true });
    }
  }

  // Validates files, writes the skills to a staging folder, and returns the preview. Nothing reaches data/skills yet.
  // `skipped` lists files a reader already dropped, such as zip symlinks.
  function stage(files, source, { playbook, skipped = [] } = {}) {
    sweepStaging();
    const found = findSkills(files, { playbook });
    found.skipped.unshift(...skipped);
    const existing = new Set(list().map((row) => row.name));
    const id = randomBytes(12).toString("hex");
    const root = join(stagingDir, id);
    const skills = [];
    const problems = [];
    const seen = new Set();
    for (const skill of found.skills) {
      const label = skill.root || "SKILL.md";
      try {
        const head = skill.files.find((file) => file.path === "SKILL.md");
        const facts = checkSkill(utf8.decode(head.bytes), skill.folder);
        if (seen.has(facts.name)) throw fail(`Another skill in this import is also named ${facts.name}.`);
        const size = skill.files.reduce((sum, file) => sum + file.bytes.length, 0);
        if (size > LIMITS.skill) throw fail("The skill is over 20 MB.");
        seen.add(facts.name);
        for (const file of skill.files) writeInside(root, `${facts.name}/${file.path}`, file.bytes);
        skills.push({
          ...facts,
          root: skill.root,
          exists: existing.has(facts.name),
          size,
          sha256: digest(skill.files),
          files: skill.files.map((file) => ({ path: file.path, size: file.bytes.length })).sort((a, b) => a.path.localeCompare(b.path)),
        });
      } catch (error) {
        problems.push({ path: label, error: error.message });
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    const preview = { id, source: cleanSource(source), skills, problems, skipped: found.skipped.slice(0, 200), skippedCount: found.skipped.length };
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "stage.json"), JSON.stringify(preview));
    return preview;
  }

  function staged(id) {
    const clean = String(id || "");
    const file = join(stagingDir, clean, "stage.json");
    if (!/^[a-f0-9]{24}$/.test(clean) || !existsSync(file)) throw fail("That preview expired. Start the import again.");
    return JSON.parse(readFileSync(file, "utf8"));
  }

  // Moves the chosen staged skills into data/skills. `replace` names the skills that may overwrite a saved one.
  function importStaged(id, names, replace = []) {
    const preview = staged(id);
    const wanted = new Set(Array.isArray(names) ? names.map(String) : []);
    const replacing = new Set(Array.isArray(replace) ? replace.map(String) : []);
    let rows = list();
    const imported = [];
    const kept = [];
    for (const skill of preview.skills) {
      if (!wanted.has(skill.name)) continue;
      const exists = rows.some((row) => row.name === skill.name);
      if (exists && !replacing.has(skill.name)) {
        kept.push(skill.name);
        continue;
      }
      if (!exists && rows.length >= LIMITS.skills) throw fail(`${LIMITS.skills} skills are saved. Remove one before importing more.`);
      const from = join(stagingDir, preview.id, skill.name);
      assertPlainTree(from);
      const target = join(skillsDir, skill.name);
      const old = join(stagingDir, `${preview.id}-old-${skill.name}`);
      // Swap by rename so a failure leaves the old copy whole.
      if (existsSync(target)) renameSync(target, old);
      try {
        renameSync(from, target);
      } catch (error) {
        if (existsSync(old)) renameSync(old, target);
        throw error;
      }
      rmSync(old, { recursive: true, force: true });
      const previous = rows.find((row) => row.name === skill.name);
      const row = {
        name: skill.name,
        description: skill.description,
        license: skill.license,
        enabled: previous ? previous.enabled : true,
        // A git skill keeps its own folder in the repo, so Update fetches only that folder.
        source: preview.source.kind === "git" ? { ...preview.source, path: skill.root } : preview.source,
        importedAt: new Date().toISOString(),
        sha256: skill.sha256,
        files: skill.files,
      };
      rows = [...rows.filter((item) => item.name !== skill.name), row];
      imported.push(skill.name);
    }
    save(rows);
    rmSync(join(stagingDir, preview.id), { recursive: true, force: true });
    return { imported, kept };
  }

  // For the Settings preview: one saved file as text, on or off. Without a path, SKILL.md and the file list.
  function file(name, path) {
    const row = find(name);
    const rel = String(path || "SKILL.md");
    const known = row.files.find((item) => item.path === rel);
    if (!known) throw fail(`No file ${rel.slice(0, 120)} in ${row.name}.`);
    const ext = extname(rel).toLowerCase();
    const image = IMAGES.has(ext);
    return {
      name: row.name,
      path: rel,
      size: known.size,
      script: SCRIPTS.has(ext),
      text: image ? "" : readFileSync(join(skillsDir, row.name, rel), "utf8"),
      ...(path ? {} : { files: row.files }),
    };
  }

  // Resolves the ref to a commit, fetches that one folder, and stages it. The preview names the commit.
  async function stageGit(input) {
    const source = parseGitSource(input, { schemes });
    const sha = await resolveRef(source, git);
    mkdirSync(stagingDir, { recursive: true });
    const work = join(stagingDir, `git-${randomBytes(8).toString("hex")}`);
    try {
      const fetched = await fetchFolder({ ...source, sha }, work, { git, maxFiles: LIMITS.files, maxBytes: LIMITS.total });
      return stage(fetched.files, { kind: "git", ...source, sha }, { skipped: fetched.skipped });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  // Checks a git skill's ref again. Same commit: up to date. New commit: a preview of that skill with files added, changed and removed.
  async function update(name) {
    const row = find(name);
    if (row.source?.kind !== "git") throw fail(`${row.name} came from a ${row.source?.kind || "folder"} import. Import it again to update it.`);
    const sha = await resolveRef(row.source, git);
    if (sha === row.source.sha) return { upToDate: true, sha };
    const preview = await stageGit({ url: row.source.url, ref: row.source.ref, path: row.source.path });
    const fresh = preview.skills.find((skill) => skill.name === row.name);
    if (!fresh) throw fail(`${row.name} is no longer in ${row.source.path || "the repo"} at ${sha.slice(0, 7)}.`);
    const before = new Map(row.files.map((file) => [file.path, file]));
    const after = new Set(fresh.files.map((file) => file.path));
    const stagedRoot = join(stagingDir, preview.id, row.name);
    const changed = fresh.files
      .filter((file) => before.has(file.path))
      .filter((file) => !readFileSync(join(stagedRoot, file.path)).equals(readFileSync(join(skillsDir, row.name, file.path))))
      .map((file) => file.path);
    return {
      upToDate: false,
      sha,
      preview: { ...preview, skills: [fresh] },
      changes: {
        added: fresh.files.filter((file) => !before.has(file.path)).map((file) => file.path),
        changed,
        removed: row.files.filter((file) => !after.has(file.path)).map((file) => file.path),
      },
    };
  }

  function toggle(name, enabled) {
    const row = find(name);
    return save(list().map((item) => (item.name === row.name ? { ...item, enabled: Boolean(enabled) } : item)));
  }

  function remove(name) {
    const row = find(name);
    rmSync(join(skillsDir, row.name), { recursive: true, force: true });
    return save(list().filter((item) => item.name !== row.name));
  }

  // skill_read: a skill's body and outline, a folder's outline, one file, or one #section of a file. Read-only.
  function read({ name, path, page } = {}) {
    const row = list().find((item) => item.name === String(name || "") && item.enabled);
    if (!row) throw fail(`No skill named ${String(name || "").slice(0, 80)}.`);
    const [rawPath, anchor] = String(path || "SKILL.md").replace(/^\.\//, "").split("#");
    const file = rawPath.replace(/\/$/, "") || "SKILL.md";
    const known = row.files.find((item) => item.path === file);
    if (!known) {
      const inside = row.files.some((item) => item.path.startsWith(`${file}/`));
      if (inside && !pathProblem(file)) return { name: row.name, folder: file, files: outline(row.files, file) };
      throw fail(`No file ${file.slice(0, 120)} in ${row.name}. Files: ${outline(row.files).map((item) => item.path).join(", ")}`);
    }
    const ext = extname(file).toLowerCase();
    if ([".png", ".jpg", ".svg"].includes(ext)) return { name: row.name, path: file, text: "This is an image. Ask can't view it." };
    let text = readFileSync(join(skillsDir, row.name, file), "utf8");
    if (file === "SKILL.md") text = readFrontmatter(text)?.body ?? text;
    if (anchor) {
      const section = sectionOf(text, anchor);
      if (section === null) throw fail(`No section #${anchor.slice(0, 80)} in ${file}.`);
      text = section;
    }
    text = rewriteLinks(text.trim(), file);
    if (SCRIPTS.has(ext)) text = `${SCRIPT_NOTE}\n\n${text}`;
    const pages = pagesOf(text);
    const number = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages.length);
    return {
      name: row.name,
      path: anchor ? `${file}#${anchor}` : file,
      ...(pages.length > 1 ? { page: number, pages: pages.length } : {}),
      text: pages[number - 1],
      ...(file === "SKILL.md" && !anchor && number === 1 ? { files: outline(row.files) } : {}),
    };
  }

  return { dir: skillsDir, list, find, read, file, stage, stageGit, update, staged, importStaged, toggle, remove, enabled: () => list().filter((row) => row.enabled) };
}

export const skillStore = openSkillStore("data");
