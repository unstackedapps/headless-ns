import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, postJson } from "./api";
import { Drawer } from "./drawer";
import { fileToBase64 } from "./files";
import { count } from "./format";
import { Markdown } from "./formatted";
import { Button, SkeletonTable } from "./load";

type Source = { kind: "folder" | "zip" | "markdown" | "git"; url?: string; ref?: string; sha?: string; path?: string };
type SkillRow = {
  name: string;
  description: string;
  license: string;
  enabled: boolean;
  source: Source;
  importedAt: string;
  fileCount: number;
  size: number;
  scripts: number;
};
type SkillsPayload = { skills: SkillRow[]; shortened: number };
type StagedSkill = {
  name: string;
  description: string;
  license: string;
  compatibility: string;
  ignoredKeys: string[];
  warnings: string[];
  exists: boolean;
  fileCount: number;
  size: number;
};
type Preview = {
  id: string;
  source: Source;
  skills: StagedSkill[];
  problems: { path: string; error: string }[];
  skipped: { path: string; reason: string }[];
  skippedCount: number;
};
type Changes = { added: string[]; changed: string[]; removed: string[] };
type FileView = { name: string; path: string; size: number; script: boolean; text: string; files?: { path: string; size: number }[] };

// The folder Oracle publishes its built Claude plugins in, at the branch the importer pins to a commit.
const ORACLE = { url: "https://github.com/oracle/netsuite-suitecloud-sdk", ref: "ai-plugins-dist", path: "anthropic" };
// Base64 adds a third, and the server takes 45 MB per upload.
const UPLOAD_BYTES = 33_000_000;

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sourceLabel(source: Source) {
  if (source.kind !== "git") return source.kind;
  const repo = String(source.url || "").replace(/^https:\/\/(www\.)?github\.com\//, "");
  return `git · ${repo} · ${String(source.sha || "").slice(0, 7)}`;
}

const say = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

// Settings > Skills: the list, the import form, the preview before import, the file drawer and remove.
// Messages and errors go to the Settings page's own lines.
export function SkillsSection({ onMessage, onError }: { onMessage: (text: string) => void; onError: (text: string | null) => void }) {
  const [data, setData] = useState<SkillsPayload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [replace, setReplace] = useState<string[]>([]);
  const [playbook, setPlaybook] = useState<{ fileName: string; data: string; name: string; description: string } | null>(null);
  const [git, setGit] = useState({ url: "", ref: "", path: "" });
  const [busy, setBusy] = useState("");
  const [viewing, setViewing] = useState<{ name: string; head: FileView | null; file: FileView | null; error: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const importForm = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    api<SkillsPayload>("/api/skills")
      .then(setData)
      .catch((reason) => onError(say(reason, "Could not read the skills.")));
  }, [onError]);

  useEffect(() => {
    if (removing) confirm.current?.showModal();
  }, [removing]);

  async function run<T>(label: string, work: () => Promise<T>) {
    setBusy(label);
    onError(null);
    try {
      return await work();
    } catch (reason) {
      onError(say(reason, "That didn't work."));
      return null;
    } finally {
      setBusy("");
    }
  }

  function show(next: Preview, nextChanges: Changes | null = null) {
    setPreview(next);
    setChanges(nextChanges);
    setPicked(next.skills.filter((skill) => !skill.exists || nextChanges).map((skill) => skill.name));
    setReplace(nextChanges ? next.skills.map((skill) => skill.name) : []);
  }

  async function stage(body: Record<string, unknown>) {
    const next = await run("stage", () => postJson<Preview>("/api/skills/stage", body));
    if (next) show(next);
  }

  async function stageFolder(list: FileList | null) {
    // The browser gives each file a path from the chosen folder. .git and node_modules never help a skill.
    const files = Array.from(list || []).filter((file) => !/(^|\/)(\.git|node_modules)\//.test(file.webkitRelativePath));
    if (!files.length) return;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > UPLOAD_BYTES) {
      onError(`That folder is ${sizeLabel(total)}. Folders over 33 MB need a zip or a Git URL.`);
      return;
    }
    setPlaybook(null);
    await run("stage", async () => {
      const encoded = await Promise.all(files.map(async (file) => ({ path: file.webkitRelativePath || file.name, base64: await fileToBase64(file) })));
      show(await postJson<Preview>("/api/skills/stage", { kind: "files", files: encoded }));
    });
  }

  async function stageFile(file: File | undefined) {
    if (!file) return;
    if (file.size > UPLOAD_BYTES) {
      onError(`That file is ${sizeLabel(file.size)}. Files over 33 MB need a Git URL.`);
      return;
    }
    const isZip = /\.zip$/i.test(file.name);
    await run("stage", async () => {
      const data = await fileToBase64(file);
      const next = await postJson<Preview>("/api/skills/stage", isZip ? { kind: "zip", data } : { kind: "markdown", fileName: file.name, data });
      const wrapped = next.skills[0];
      setPlaybook(isZip || !wrapped ? null : { fileName: file.name, data, name: wrapped.name, description: wrapped.description });
      show(next);
    });
  }

  function stageGit(event: FormEvent) {
    event.preventDefault();
    setPlaybook(null);
    stage({ kind: "git", ...git });
  }

  function useOracle() {
    setGit(ORACLE);
    setPlaybook(null);
    if (importForm.current) importForm.current.open = true;
    stage({ kind: "git", ...ORACLE });
  }

  async function importPicked() {
    if (!preview) return;
    const done = await run("import", async () => {
      let stagedId = preview.id;
      let names = picked;
      let replacing = replace;
      // A Markdown playbook the person renamed is staged again with the new name and description.
      const wrapped = preview.skills[0];
      if (playbook && wrapped && (playbook.name !== wrapped.name || playbook.description !== wrapped.description)) {
        const again = await postJson<Preview>("/api/skills/stage", {
          kind: "markdown",
          fileName: playbook.fileName,
          data: playbook.data,
          playbook: { name: playbook.name, description: playbook.description },
        });
        if (!again.skills[0]) throw new Error(again.problems[0]?.error || "That name or description isn't valid.");
        stagedId = again.id;
        names = picked.length ? [again.skills[0].name] : [];
        replacing = replace.includes(wrapped.name) ? names : [];
      }
      return postJson<SkillsPayload & { imported: string[]; kept: string[] }>("/api/skills/import", { stagedId, names, replace: replacing });
    });
    if (!done) return;
    setData(done);
    setPreview(null);
    setChanges(null);
    setPlaybook(null);
    const skippedNote = preview.skippedCount ? ` Skipped ${count(preview.skippedCount)} files Ask can't use.` : "";
    if (changes && done.imported[0]) onMessage(`Updated ${done.imported[0]} to ${String(preview.source.sha || "").slice(0, 7)}.`);
    else onMessage(`Imported ${done.imported.length} ${done.imported.length === 1 ? "skill" : "skills"}.${skippedNote}${done.kept.length ? ` Kept ${done.kept.join(", ")} as saved.` : ""}`);
  }

  // The box flips at once, like the model picker, and flips back if the save fails.
  async function toggle(name: string, enabled: boolean) {
    const flip = (on: boolean) => setData((current) => current && { ...current, skills: current.skills.map((item) => (item.name === name ? { ...item, enabled: on } : item)) });
    flip(enabled);
    const next = await run(`toggle-${name}`, () => postJson<SkillsPayload>("/api/skills/toggle", { name, enabled }));
    if (next) setData(next);
    else flip(!enabled);
  }

  async function update(name: string) {
    const result = await run(`update-${name}`, () => postJson<{ upToDate: boolean; sha: string; preview?: Preview; changes?: Changes }>("/api/skills/update", { name }));
    if (!result) return;
    if (result.upToDate || !result.preview) {
      onMessage(`${name} is already up to date at ${result.sha.slice(0, 7)}.`);
      return;
    }
    setPlaybook(null);
    show(result.preview, result.changes || null);
  }

  async function remove() {
    const name = removing;
    confirm.current?.close();
    if (!name) return;
    const next = await run(`remove-${name}`, () => postJson<SkillsPayload>("/api/skills/remove", { name }));
    if (next) {
      setData(next);
      onMessage(`Removed ${name}.`);
    }
  }

  async function open(name: string, path?: string) {
    setViewing((current) => ({ name, head: current?.name === name ? current.head : null, file: null, error: null }));
    try {
      const view = await postJson<FileView>("/api/skills/file", { name, ...(path ? { path } : {}) });
      setViewing((current) => (current?.name === name ? { ...current, ...(path ? { file: view } : { head: view }), error: null } : current));
    } catch (reason) {
      setViewing((current) => (current?.name === name ? { ...current, error: say(reason, "Could not read that file.") } : current));
    }
  }

  const rows = data?.skills || [];
  const shown = viewing?.file || viewing?.head || null;
  const row = rows.find((item) => item.name === viewing?.name);

  return (
    <section className="section" aria-labelledby="skills-title">
      <h2 id="skills-title">Skills</h2>
      <p className="status">Ask sees the name and description of each skill that is on, and reads the rest when a question needs it. Ask never runs a skill's scripts, and changes still wait for Run.</p>
      {data && data.shortened > 0 && <p className="status">Ask sees shortened descriptions for {data.shortened} skills.</p>}
      {!data && <SkeletonTable rows={3} cols={3} />}
      {data && rows.length === 0 && (
        <p className="status">
          No skills yet. Import a folder, a zip or a Git URL, or{" "}
          <button className="linkish" type="button" onClick={useOracle} disabled={Boolean(busy)}>
            use Oracle's NetSuite skills
          </button>
          .
        </p>
      )}
      {rows.length > 0 && (
        <ul className="skill-list">
          {rows.map((skill) => (
            <li key={skill.name}>
              <label className="check">
                <input type="checkbox" checked={skill.enabled} onChange={(event) => toggle(skill.name, event.target.checked)} />
                <strong>{skill.name}</strong>
              </label>
              <span className="note skill-description" title={skill.description}>
                {skill.description}
              </span>
              <span className="note">{sourceLabel(skill.source)}</span>
              <span className="skill-actions">
                <button className="quiet" type="button" aria-label={`Preview ${skill.name}`} onClick={() => open(skill.name)}>
                  Preview
                </button>
                {skill.source.kind === "git" && (
                  <Button className="quiet" aria-label={`Update ${skill.name}`} busy={busy === `update-${skill.name}`} onClick={() => update(skill.name)}>
                    Update
                  </Button>
                )}
                <Button className="quiet" aria-label={`Remove ${skill.name}`} busy={busy === `remove-${skill.name}`} onClick={() => setRemoving(skill.name)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="panel" ref={importForm}>
        <summary>Import skills</summary>
        <div className="form skill-import">
          <label>
            A skill folder or plugin folder
            <input type="file" {...{ webkitdirectory: "" }} multiple disabled={Boolean(busy)} onChange={(event) => stageFolder(event.target.files)} />
          </label>
          <label>
            A zip, or one Markdown file (AGENTS.md, CLAUDE.md, .mdc)
            <input type="file" accept=".zip,.md,.mdc" disabled={Boolean(busy)} onChange={(event) => stageFile(event.target.files?.[0])} />
          </label>
        </div>
        <form className="form skill-import" onSubmit={stageGit}>
          <label>
            Git URL
            <input type="url" required pattern="https://.*" placeholder="https://github.com/owner/repo" value={git.url} onChange={(event) => setGit({ ...git, url: event.target.value })} />
          </label>
          <label>
            Branch, tag or commit
            <input placeholder="Default branch" value={git.ref} onChange={(event) => setGit({ ...git, ref: event.target.value })} />
          </label>
          <label>
            Folder in the repo
            <input placeholder="Whole repo" value={git.path} onChange={(event) => setGit({ ...git, path: event.target.value })} />
          </label>
          <div className="actions">
            <Button className="primary" type="submit" busy={busy === "stage"} disabled={Boolean(busy)}>
              Preview from Git
            </Button>
            <button className="linkish" type="button" onClick={useOracle} disabled={Boolean(busy)}>
              Use Oracle's NetSuite skills
            </button>
          </div>
          <p className="note">Public https repos only. The app saves the exact commit, and Update checks the branch or tag again.</p>
        </form>
      </details>

      {preview && (
        <section className="panel" aria-label="Import preview">
          <h3>
            {changes
              ? `Update ${preview.skills[0]?.name} to ${String(preview.source.sha || "").slice(0, 7)}`
              : `Found ${preview.skills.length} ${preview.skills.length === 1 ? "skill" : "skills"} in ${sourceLabel(preview.source)}`}
          </h3>
          {changes && (
            <p className="status">
              {changes.added.length} added, {changes.changed.length} changed, {changes.removed.length} removed.
            </p>
          )}
          {changes && (
            <details>
              <summary>Show the files</summary>
              <ul className="steps">
                {changes.added.map((path) => <li key={`a-${path}`}>Added {path}</li>)}
                {changes.changed.map((path) => <li key={`c-${path}`}>Changed {path}</li>)}
                {changes.removed.map((path) => <li key={`r-${path}`}>Removed {path}</li>)}
              </ul>
            </details>
          )}
          {playbook && preview.skills[0] && (
            <div className="form">
              <label>
                Name
                <input value={playbook.name} onChange={(event) => setPlaybook({ ...playbook, name: event.target.value })} />
              </label>
              <label>
                Description
                <textarea value={playbook.description} maxLength={1024} onChange={(event) => setPlaybook({ ...playbook, description: event.target.value })} />
              </label>
            </div>
          )}
          {!changes && (
            <ul className="skill-picks">
              {preview.skills.map((skill) => (
                <li key={skill.name}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={picked.includes(skill.name)}
                      onChange={(event) => setPicked((current) => (event.target.checked ? [...current, skill.name] : current.filter((name) => name !== skill.name)))}
                    />
                    <strong>{skill.name}</strong>
                    <span className="note">
                      {count(skill.fileCount)} files · {sizeLabel(skill.size)}
                      {skill.license ? ` · ${skill.license}` : ""}
                    </span>
                  </label>
                  <p className="note">{skill.description}</p>
                  {skill.exists && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={replace.includes(skill.name)}
                        onChange={(event) => setReplace((current) => (event.target.checked ? [...current, skill.name] : current.filter((name) => name !== skill.name)))}
                      />
                      Replace the saved {skill.name}. Unticked, the saved copy stays.
                    </label>
                  )}
                  {skill.warnings.map((warning) => (
                    <p key={warning} className="note">
                      {warning}
                    </p>
                  ))}
                  {skill.ignoredKeys.length > 0 && <p className="note">Ignored keys: {skill.ignoredKeys.join(", ")}</p>}
                </li>
              ))}
            </ul>
          )}
          {preview.problems.length > 0 && (
            <>
              <p className="status">These couldn't be imported:</p>
              <ul className="steps">
                {preview.problems.map((problem) => (
                  <li key={problem.path}>
                    {problem.path}: {problem.error}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.skippedCount > 0 && (
            <details>
              <summary>Skipped {count(preview.skippedCount)} files Ask can't use</summary>
              <ul className="steps">
                {preview.skipped.map((item) => (
                  <li key={item.path}>
                    {item.path}: {item.reason}
                  </li>
                ))}
                {preview.skippedCount > preview.skipped.length && <li>and {count(preview.skippedCount - preview.skipped.length)} more</li>}
              </ul>
            </details>
          )}
          <div className="actions">
            <Button className="primary" busy={busy === "import"} disabled={!picked.length || Boolean(busy)} onClick={importPicked}>
              {changes ? "Update" : picked.length === 1 ? "Import 1 skill" : `Import ${picked.length} skills`}
            </Button>
            <button
              className="quiet"
              type="button"
              onClick={() => {
                setPreview(null);
                setChanges(null);
                setPlaybook(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {viewing && (
        <Drawer
          kicker="Skill"
          title={viewing.file ? `${viewing.name} · ${viewing.file.path}` : viewing.name}
          narrow
          loading={!shown && !viewing.error ? "Reading the skill." : false}
          error={viewing.error}
          onClose={() => setViewing(null)}
          head={
            row && (
              <p className="note">
                {row.license || "No license given"} · {sourceLabel(row.source)} · {count(row.fileCount)} files · {sizeLabel(row.size)}
                {row.scripts > 0 ? ` · ${row.scripts} scripts, not run by Ask` : ""}
              </p>
            )
          }
        >
          <div className="record-body">
            {viewing.file && (
              <button className="linkish" type="button" onClick={() => setViewing({ ...viewing, file: null })}>
                Back to SKILL.md
              </button>
            )}
            {shown?.script && <p className="status">Not run by Ask. Ask can read this script as a description of the steps.</p>}
            {shown && /\.(md|mdc)$/i.test(shown.path) && <Markdown text={shown.text.replace(/^---\n[\s\S]*?\n---\n/, "")} />}
            {shown && !/\.(md|mdc)$/i.test(shown.path) && (shown.text ? <pre className="result">{shown.text}</pre> : <p className="status">This is an image. The preview shows text files only.</p>)}
            {!viewing.file && viewing.head?.files && (
              <details>
                <summary>{count(viewing.head.files.length)} files</summary>
                <ul className="skill-files">
                  {viewing.head.files.map((item) => (
                    <li key={item.path}>
                      <button className="linkish" type="button" onClick={() => open(viewing.name, item.path)}>
                        {item.path}
                      </button>{" "}
                      <span className="note">
                        {sizeLabel(item.size)}
                        {/\.(py|sh)$/i.test(item.path) ? " · not run by Ask" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Drawer>
      )}

      <dialog ref={confirm} className="confirm" aria-labelledby="remove-title" onClose={() => setRemoving(null)}>
        <h3 id="remove-title">Remove {removing}?</h3>
        <p>{rows.find((item) => item.name === removing)?.source.kind === "git" ? "You can import it again from Git." : "Folder and zip imports can't be fetched again."}</p>
        <div className="actions">
          <button className="primary" type="button" onClick={remove}>
            Remove
          </button>
          <button className="quiet" type="button" onClick={() => confirm.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </section>
  );
}
