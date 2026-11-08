import { useEffect, useRef, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";
import { RefreshButton, refreshScope } from "./refresh";
import { api } from "./api";

type Field = { id: string; title: string; type: "string" | "number" | "boolean" };
type Scalar = { id: string; value: string | number | boolean };
type Action = { id: string; label: string };

function blank(fields: Field[]) {
  return Object.fromEntries(fields.map((field) => [field.id, ""]));
}

function filled(fields: Field[], values: Scalar[]) {
  const have = new Map(values.map((row) => [row.id, row.value]));
  return Object.fromEntries(fields.map((field) => [field.id, have.has(field.id) ? String(have.get(field.id)) : ""]));
}

function showValue(field: Field, value: string) {
  if (!value) return "—";
  if (field.type === "boolean") return value === "true" ? "Yes" : "No";
  return value;
}

function changes(fields: Field[], current: Record<string, string>, original: Record<string, string>) {
  const data: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const next = current[field.id] ?? "";
    if (next === (original[field.id] ?? "")) continue;
    if (field.type === "boolean") data[field.id] = next === "true";
    else if (field.type === "number") {
      if (next.trim() === "" || Number.isNaN(Number(next))) continue;
      data[field.id] = Number(next);
    } else data[field.id] = next;
  }
  return data;
}

export function RecordsPage() {
  const [types, setTypes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [recordId, setRecordId] = useState("");
  const [openId, setOpenId] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [filePath, setFilePath] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [needle, setNeedle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const typeRef = useRef("");
  const fieldsRef = useRef<Field[]>([]);
  const valuesRef = useRef<Scalar[]>([]);

  useEffect(() => {
    let stop = false;
    api<{ types: string[] }>("/api/records/types")
      .then((body) => {
        if (!stop) setTypes(body.types);
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "records") {
        api<{ types: string[] }>("/api/records/types")
          .then((body) => setTypes(body.types))
          .catch((reason: Error) => setError(reason.message));
      }
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, []);

  function remember(list: Field[], values: Scalar[]) {
    const next = values.length ? filled(list, values) : blank(list);
    setDraft(next);
    setSaved(next);
  }

  function choose(next: string) {
    typeRef.current = next;
    valuesRef.current = [];
    setType(next);
    setOpenId("");
    setEditing(false);
    setCreating(false);
    setConfirm(false);
    setNotice("");
    setActions([]);
    setError(null);
    api<{ fields: Field[] }>(`/api/records/fields?type=${encodeURIComponent(next)}`)
      .then((body) => {
        if (typeRef.current !== next) return;
        fieldsRef.current = body.fields;
        setFields(body.fields);
        remember(body.fields, valuesRef.current);
      })
      .catch((reason: Error) => setError(reason.message));
    api<{ targets: string[] }>(`/api/records/transforms?type=${encodeURIComponent(next)}`)
      .then((body) => {
        setTargets(body.targets);
        setTarget(body.targets[0] || "");
      })
      .catch(() => setTargets([]));
  }

  async function openRecord(id = recordId) {
    if (!type || !id.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const [record, actionList] = await Promise.all([
        api<{ id: string; fields: Scalar[] }>(`/api/records?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id.trim())}`),
        api<{ actions: Action[] }>(`/api/records/actions?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id.trim())}`),
      ]);
      valuesRef.current = record.fields;
      remember(fieldsRef.current.length ? fieldsRef.current : fields, record.fields);
      setOpenId(record.id);
      setRecordId(record.id);
      setActions(actionList.actions);
      setEditing(false);
      setCreating(false);
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The record did not open.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!confirm || busy) return;
    const data = changes(fields, draft, creating ? blank(fields) : saved);
    if (!Object.keys(data).length) {
      setError("Nothing to save.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string }>("/api/records", {
        method: "POST",
        body: JSON.stringify({ recordType: type, recordId: creating ? "" : openId, data, confirm: true }),
      });
      setNotice(creating ? "The record was created." : "The record was saved.");
      setConfirm(false);
      if (result.id) await openRecord(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The record was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(actionId: string) {
    if (!confirm || !openId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/records/action", {
        method: "POST",
        body: JSON.stringify({ recordType: type, recordId: openId, actionId, confirm: true }),
      });
      setNotice("The action ran.");
      setConfirm(false);
      await openRecord(openId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action did not run.");
    } finally {
      setBusy(false);
    }
  }

  async function transform() {
    if (!confirm || !openId || !target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; type: string }>("/api/records/transform", {
        method: "POST",
        body: JSON.stringify({ sourceRecordType: type, sourceRecordId: openId, targetRecordType: target, confirm: true }),
      });
      setNotice(result.id ? `Created ${result.type} ${result.id}.` : "The new record was created.");
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The record was not created.");
    } finally {
      setBusy(false);
    }
  }

  async function linkFile(detach: boolean) {
    if (!confirm || !openId || !filePath.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/records/file", {
        method: "POST",
        body: JSON.stringify({ path: filePath.trim(), recordType: type, recordId: openId, detach, confirm: true }),
      });
      setNotice(detach ? "The file was detached." : "The file was attached.");
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The file was not changed.");
    } finally {
      setBusy(false);
    }
  }

  const shown = types.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleFields = fields.filter((field) => `${field.title} ${field.id}`.toLowerCase().includes(needle.trim().toLowerCase()));
  const formOpen = editing || creating;

  return (
    <div className="split-page">
      <header className="page-head">
        <div>
          <div className="kicker">Record types</div>
          <h1>Records</h1>
        </div>
        <RefreshButton label="records" onClick={() => refreshScope("records")} />
      </header>
      <p className="status">Pick a type, then open one by its internal id. Lists on the record stay in NetSuite.</p>
      {error && <p className="error">{error}</p>}
      <div className="split">
        <div className="split-rail">
          <label className="search-field">
            <Glyph icon={glyph.search} size={14} />
            <input className="search" value={query} placeholder="Filter types" aria-label="Filter types" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="tool-list">
            {shown.map((name) => (
              <button key={name} type="button" className={type === name ? "tool on" : "tool"} onClick={() => choose(name)}>
                <span>{name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="split-main">
          {!type && <p className="split-empty">Pick a record type on the left.</p>}
          {type && (
            <>
              <div className="pane-head">
                <strong>{openId ? `${type} ${openId}` : type}</strong>
                <div className="filters">
                  <label>
                    Internal id
                    <input value={recordId} inputMode="numeric" aria-label="Internal id" onChange={(event) => setRecordId(event.target.value)} />
                  </label>
                  <button className="primary" type="button" disabled={busy || !recordId.trim()} onClick={() => openRecord()}>
                    Open
                  </button>
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => {
                      setCreating(true);
                      setEditing(false);
                      setOpenId("");
                      setDraft(blank(fields));
                      setNotice("");
                      setConfirm(false);
                    }}
                  >
                    New
                  </button>
                  {openId && !formOpen && (
                    <button className="quiet" type="button" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
              {notice && <p className="status">{notice}</p>}
              <label className="search-field">
                <Glyph icon={glyph.search} size={14} />
                <input className="search" value={needle} placeholder="Find a field" aria-label="Find a field" onChange={(event) => setNeedle(event.target.value)} />
              </label>
              {formOpen ? (
                <div className="record-form">
                  {visibleFields.map((field) => (
                    <label key={field.id}>
                      {field.title}
                      {field.type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={draft[field.id] === "true"}
                          onChange={(event) => setDraft((current) => ({ ...current, [field.id]: event.target.checked ? "true" : "false" }))}
                        />
                      ) : (
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          value={draft[field.id] || ""}
                          onChange={(event) => setDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                        />
                      )}
                    </label>
                  ))}
                  <p className="status">Empty fields are left out.</p>
                </div>
              ) : (
                <dl className="field-grid">
                  {visibleFields.map((field) => (
                    <div key={field.id}>
                      <dt>{field.title}</dt>
                      <dd>{showValue(field, saved[field.id] || "")}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {(formOpen || openId) && (
                <label className="check">
                  <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
                  I mean to run this. It can change NetSuite.
                </label>
              )}
              {formOpen && (
                <div className="actions">
                  <button className="primary" type="button" disabled={!confirm || busy} onClick={save}>
                    {creating ? "Create" : "Save"}
                  </button>
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setCreating(false);
                      setDraft(saved);
                      setConfirm(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {openId && actions.length > 0 && (
                <section className="section">
                  <h2>Actions</h2>
                  <div className="actions">
                    {actions.map((action) => (
                      <button key={action.id} className="quiet" type="button" disabled={!confirm || busy} onClick={() => runAction(action.id)}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {openId && targets.length > 0 && (
                <section className="section">
                  <h2>Turn this into</h2>
                  <div className="filters">
                    <label>
                      New record
                      <Pick
                        label="New record"
                        value={target}
                        onChange={setTarget}
                        options={targets.map((item) => ({ value: item, label: item }))}
                      />
                    </label>
                    <button className="primary" type="button" disabled={!confirm || busy || !target} onClick={transform}>
                      Create
                    </button>
                  </div>
                  <p className="status">NetSuite fills the new record from this one.</p>
                </section>
              )}
              {openId && (
                <section className="section">
                  <h2>File</h2>
                  <div className="filters">
                    <label>
                      Cabinet path
                      <input value={filePath} aria-label="Cabinet path" placeholder="/Images/note.txt" onChange={(event) => setFilePath(event.target.value)} />
                    </label>
                    <button className="quiet" type="button" disabled={!confirm || busy || !filePath.trim()} onClick={() => linkFile(false)}>
                      Attach
                    </button>
                    <button className="quiet" type="button" disabled={!confirm || busy || !filePath.trim()} onClick={() => linkFile(true)}>
                      Detach
                    </button>
                  </div>
                  <p className="status">The file stays in the cabinet either way.</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
