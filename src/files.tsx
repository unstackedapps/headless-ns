import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";
import { RefreshButton, refreshScope } from "./refresh";

type Entry = { id: string; kind: "folder" | "file"; name: string; path: string };
type Page = { entries: Entry[]; hasMore: boolean; cursor: string | null };
type Preview = { name: string; path?: string; text?: string; image?: string; note?: string };

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("That file could not be read from this computer."));
    reader.readAsDataURL(file);
  });
}

function foldersOf(page: Page | undefined) {
  return (page?.entries || []).filter((entry) => entry.kind === "folder");
}

function folderLabel(path: string) {
  if (path === "/") return "File Cabinet";
  return path.split("/").filter(Boolean).pop() || path;
}

export function FilesPage() {
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [opened, setOpened] = useState<Record<string, boolean>>({ "/": true });
  const [selected, setSelected] = useState("/");
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  const [hits, setHits] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [jumpPath, setJumpPath] = useState("");
  const [jumpId, setJumpId] = useState("");
  const [jumpKind, setJumpKind] = useState("folder");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  async function loadFolder(path: string, cursor?: string | null) {
    const response = await fetch(
      `/api/files?path=${encodeURIComponent(path)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The folder did not load.");
    setPages((current) => ({
      ...current,
      [path]: {
        entries: [...(cursor ? current[path]?.entries || [] : []), ...(body.entries || [])],
        hasMore: Boolean(body.hasMore),
        cursor: body.cursor || null,
      },
    }));
    setError(null);
  }

  useEffect(() => {
    let stop = false;
    loadFolder("/").catch((reason: Error) => {
      if (!stop) setError(reason.message);
    });
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "files") {
        loadFolder("/").catch((reason: Error) => setError(reason.message));
        if (selectedRef.current !== "/") loadFolder(selectedRef.current).catch((reason: Error) => setError(reason.message));
      }
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!needle) {
      setHits(null);
      return;
    }
    let stop = false;
    fetch(`/api/files/search?q=${encodeURIComponent(needle)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The file search did not run.");
        if (!stop) setHits(body.entries || []);
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
    return () => {
      stop = true;
    };
  }, [needle]);

  function toggle(path: string) {
    setOpened((current) => ({ ...current, [path]: !current[path] }));
    if (!pages[path]) loadFolder(path).catch((reason: Error) => setError(reason.message));
  }

  function choose(path: string) {
    setSelected(path);
    setQuery("");
    setNeedle("");
    setOpened((current) => ({ ...current, [path]: true }));
    if (!pages[path]) loadFolder(path).catch((reason: Error) => setError(reason.message));
  }

  function dragOver(event: DragEvent, folder: string) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (dropTarget !== folder) setDropTarget(folder);
  }

  function dragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDropTarget(null);
  }

  async function dropFiles(event: DragEvent, folder: string) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    if (folder === "/") {
      setError("Pick a folder inside the cabinet. The top level cannot hold a file.");
      return;
    }
    setError(null);
    try {
      for (const file of files) {
        if (file.size > 8_000_000) throw new Error(`${file.name} is too large to upload.`);
        setUploading(file.name);
        const response = await fetch("/api/files/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, name: file.name, contentBase64: await fileToBase64(file) }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The upload did not finish.");
      }
      await loadFolder(folder);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The upload did not finish.");
    } finally {
      setUploading(null);
    }
  }

  async function readFile(entry: Entry) {
    setReading(true);
    setPreview(null);
    setOpenError(null);
    try {
      const response = await fetch("/api/files/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The file contents did not load.");
      setPreview({ ...body, path: entry.path });
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : "The file contents did not load.");
    } finally {
      setReading(false);
    }
  }

  async function jump() {
    setOpenError(null);
    const payload = jumpPath.trim() ? { path: jumpPath.trim(), kind: jumpKind } : { id: jumpId.trim(), kind: jumpKind };
    try {
      const response = await fetch("/api/files/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "That path did not resolve.");
      if (!body.path) throw new Error("NetSuite did not return a path.");
      if (body.kind === "file") {
        const folder = body.path.split("/").slice(0, -1).join("/") || "/";
        choose(folder);
        await readFile({ id: String(body.id || ""), kind: "file", name: body.path.split("/").pop() || body.path, path: body.path });
        return;
      }
      choose(body.path);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : "That path did not resolve.");
    }
  }

  async function openNative() {
    if (!preview?.path) return;
    setOpenError(null);
    try {
      const response = await fetch("/api/files/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: preview.path }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "NetSuite did not return a link for that file.");
      window.open(body.url, "_blank", "noopener");
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : "NetSuite did not return a link for that file.");
    }
  }

  const page = pages[selected];
  const rows = needle ? hits || [] : page?.entries || [];

  return (
    <div className="split-page">
      <header className="page-head">
        <div>
          <div className="kicker">File Cabinet</div>
          <h1>Files</h1>
        </div>
        <RefreshButton label="files" onClick={() => refreshScope("files")} />
      </header>
      <p className="status">Pick a folder on the left. Drop files onto a folder to upload them. Click a file to read it.</p>
      {uploading && <p className="status">Uploading {uploading}</p>}
      {error && <p className="error">{error}</p>}
      <div className="split">
        <div className="split-rail" aria-label="Folders" onDragLeave={dragLeave}>
          <div
            className={["tree-row", selected === "/" ? "on" : "", dropTarget === "/" ? "is-drop" : ""].filter(Boolean).join(" ")}
            onDragOver={(event) => dragOver(event, "/")}
            onDrop={(event) => dropFiles(event, "/")}
          >
            <button type="button" className="twist" aria-expanded={Boolean(opened["/"])} aria-label="File Cabinet" onClick={() => toggle("/")}>
              <ChevronRight className={opened["/"] ? "twist-open" : undefined} size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button type="button" className="tree-name" onClick={() => choose("/")}>
              <Glyph icon={glyph.folder} size={14} />
              <span>File Cabinet</span>
            </button>
          </div>
          {opened["/"] && (
            <Branch
              path="/"
              depth={1}
              pages={pages}
              opened={opened}
              selected={selected}
              dropTarget={dropTarget}
              onToggle={toggle}
              onChoose={choose}
              onDragOver={dragOver}
              onDrop={dropFiles}
            />
          )}
        </div>
        <div
          className={dropTarget === selected ? "split-main is-drop" : "split-main"}
          onDragOver={(event) => dragOver(event, selected)}
          onDragLeave={dragLeave}
          onDrop={(event) => dropFiles(event, selected)}
        >
          <div className="pane-head">
            <strong>{needle ? "Search" : folderLabel(selected)}</strong>
            <label className="search-field">
              <Glyph icon={glyph.search} size={14} />
              <input
                className="search"
                value={query}
                placeholder="Search file names"
                aria-label="Search file names"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="filters">
            <label>
              Path
              <input value={jumpPath} aria-label="Path" placeholder="/SuiteScripts" onChange={(event) => setJumpPath(event.target.value)} />
            </label>
            <label>
              Internal id
              <input value={jumpId} aria-label="Internal id" inputMode="numeric" onChange={(event) => setJumpId(event.target.value)} />
            </label>
            <label>
              Kind
              <Pick
                label="Kind"
                value={jumpKind}
                onChange={setJumpKind}
                options={[
                  { value: "folder", label: "Folder" },
                  { value: "file", label: "File" },
                ]}
              />
            </label>
            <button className="quiet" type="button" disabled={!jumpPath.trim() && !jumpId.trim()} onClick={jump}>
              Go
            </button>
          </div>
          {openError && <p className="error">{openError}</p>}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>{needle ? "Path" : "Kind"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={`${entry.kind}:${entry.path}`}>
                  <td>
                    {entry.kind === "folder" && !needle ? (
                      <button className="linkish" type="button" onClick={() => choose(entry.path)}>
                        <Glyph icon={glyph.folder} size={14} />
                        {entry.name || entry.path}
                      </button>
                    ) : (
                      <button className="linkish" type="button" onClick={() => readFile(entry)}>
                        <Glyph icon={glyph.file} size={14} />
                        {entry.name || entry.path}
                      </button>
                    )}
                  </td>
                  <td>{needle ? entry.path : entry.kind === "folder" ? "Folder" : "File"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={2}>
                    {needle ? "No files matched that name." : page ? "This folder is empty." : "Loading this folder."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!needle && page?.hasMore && (
            <button className="quiet" type="button" onClick={() => loadFolder(selected, page.cursor).catch((reason: Error) => setError(reason.message))}>
              More
            </button>
          )}
          {(reading || preview) && (
            <section className="file-view" aria-label="File contents">
              <div className="pane-head">
                <strong>{preview?.name || "File"}</strong>
                <div className="actions">
                  {preview?.path && (
                    <button className="quiet" type="button" onClick={openNative}>
                      <Glyph icon={glyph.external} size={14} />
                      Open in NetSuite
                    </button>
                  )}
                  <button className="quiet" type="button" onClick={() => setPreview(null)}>
                    Close
                  </button>
                </div>
              </div>
              {reading && <p className="status">Reading the file.</p>}
              {preview?.text != null && <pre>{preview.text}</pre>}
              {preview?.image && <img src={preview.image} alt="" />}
              {preview?.note && <p className="status">{preview.note}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Branch({
  path,
  depth,
  pages,
  opened,
  selected,
  dropTarget,
  onToggle,
  onChoose,
  onDragOver,
  onDrop,
}: {
  path: string;
  depth: number;
  pages: Record<string, Page>;
  opened: Record<string, boolean>;
  selected: string;
  dropTarget: string | null;
  onToggle: (path: string) => void;
  onChoose: (path: string) => void;
  onDragOver: (event: DragEvent, folder: string) => void;
  onDrop: (event: DragEvent, folder: string) => void;
}) {
  return foldersOf(pages[path]).map((folder) => {
    const isOpen = Boolean(opened[folder.path]);
    const known = Boolean(pages[folder.path]);
    const nested = foldersOf(pages[folder.path]);
    return (
      <div key={folder.path}>
        <div
          className={["tree-row", selected === folder.path ? "on" : "", dropTarget === folder.path ? "is-drop" : ""].filter(Boolean).join(" ")}
          style={{ paddingLeft: depth * 14 }}
          onDragOver={(event) => onDragOver(event, folder.path)}
          onDrop={(event) => onDrop(event, folder.path)}
        >
          <button type="button" className="twist" aria-expanded={isOpen} aria-label={folder.name} onClick={() => onToggle(folder.path)}>
            {(!known || nested.length > 0) && (
              <ChevronRight className={isOpen ? "twist-open" : undefined} size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <button type="button" className="tree-name" onClick={() => onChoose(folder.path)}>
            <Glyph icon={glyph.folder} size={14} />
            <span>{folder.name}</span>
          </button>
        </div>
        {isOpen && (
          <Branch
            path={folder.path}
            depth={depth + 1}
            pages={pages}
            opened={opened}
            selected={selected}
            dropTarget={dropTarget}
            onToggle={onToggle}
            onChoose={onChoose}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
        )}
      </div>
    );
  });
}
