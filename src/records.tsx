import { useEffect, useRef, useState } from "react";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";
import { RefreshButton, refreshScope } from "./refresh";
import { api, postJson } from "./api";

type Field = {
  id: string;
  title: string;
  type: "string" | "number" | "boolean" | "ref" | "select";
  source?: string;
  options?: string[];
};
type Sublist = { id: string; title: string; fields: Field[] };
type Cell = { value: string; refName?: string };
type Values = Record<string, Cell>;
type ReadCell = { id: string; value: string | number | boolean; refName?: string };
type ReadRecord = { id: string; fields: ReadCell[]; sublists: { id: string; lines: Record<string, ReadCell>[] }[] };
type Action = { id: string; label: string; parameters: string[] };
type Line = { line?: number; values: Values; original?: Values };
type Created = { id: string; type: string; note?: string };
type Wire = string | number | boolean | null | { id: string };

const LINE_COLUMNS = ["item", "description", "quantity", "rate", "amount", "isClosed"];
const SHIPPING = new Set(["itemfulfillment", "itemreceipt"]);

// The Records screen opens from #/records?type=salesorder&id=123.
export function recordLink(type: string, id: string) {
  return `#/records?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

function hashParams() {
  const query = location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  return { type: params.get("type") || "", id: params.get("id") || "" };
}

function cellOf(read?: ReadCell): Cell {
  if (!read) return { value: "" };
  return read.refName != null ? { value: String(read.value), refName: read.refName } : { value: String(read.value) };
}

function valuesOf(fields: Field[], cells: Record<string, ReadCell>): Values {
  return Object.fromEntries(fields.map((field) => [field.id, cellOf(cells[field.id])]));
}

function wire(field: Field, cell: Cell): Wire | undefined {
  const text = cell.value.trim();
  if (field.type === "boolean") return text === "true";
  if (!text) return undefined;
  if (field.type === "ref" || field.type === "select") return { id: text };
  if (field.type === "number") return Number.isNaN(Number(text)) ? undefined : Number(text);
  return text;
}

// Changed fields only. A field emptied by the user is sent as null, which clears it in NetSuite.
function changes(fields: Field[], current: Values, original: Values | null) {
  const data: Record<string, Wire> = {};
  for (const field of fields) {
    const next = current[field.id] ?? { value: "" };
    const before = original?.[field.id] ?? { value: "" };
    if (next.value === before.value) continue;
    const value = wire(field, next);
    if (value !== undefined) data[field.id] = value;
    else if (original && before.value !== "") data[field.id] = null;
  }
  return data;
}

function showCell(field: Field | undefined, cell: Cell | ReadCell | undefined) {
  if (!cell || cell.value === "" || cell.value == null) return "—";
  if (cell.refName) return cell.refName;
  if (field?.type === "boolean" || typeof cell.value === "boolean") return String(cell.value) === "true" ? "Yes" : "No";
  return String(cell.value);
}

function lineColumns(sublist: Sublist) {
  const have = new Map(sublist.fields.map((field) => [field.id, field]));
  const picked = LINE_COLUMNS.map((id) => have.get(id)).filter((field): field is Field => Boolean(field));
  return picked.length ? picked : sublist.fields.slice(0, 5);
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function RefPicker({ field, cell, onChange }: { field: Field; cell: Cell; onChange: (cell: Cell) => void }) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !field.source) return;
    let stop = false;
    const timer = window.setTimeout(() => {
      api<{ options: { id: string; label: string }[] }>(
        `/api/records/lookup?source=${encodeURIComponent(field.source || "")}&q=${encodeURIComponent(text)}`,
      )
        .then((body) => {
          if (!stop) {
            setOptions(body.options);
            setError("");
          }
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [text, open, field.source]);

  if (field.type === "select") {
    return (
      <select value={cell.value} aria-label={field.title} onChange={(event) => onChange({ value: event.target.value })}>
        <option value="">—</option>
        {(field.options || []).map((option) => (
          <option key={option} value={option}>
            {option === cell.value && cell.refName ? `${option} · ${cell.refName}` : option}
          </option>
        ))}
      </select>
    );
  }

  if (!field.source) {
    return (
      <input
        value={cell.value}
        inputMode="numeric"
        aria-label={`${field.title} internal id`}
        placeholder="Internal id"
        onChange={(event) => onChange({ value: event.target.value.replace(/[^\d-]/g, "") })}
      />
    );
  }

  return (
    <div className="ref-picker">
      <div className="ref-current">
        <span>{cell.value ? cell.refName || `id ${cell.value}` : "None"}</span>
        {cell.value && (
          <button className="linkish" type="button" onClick={() => onChange({ value: "" })}>
            Clear
          </button>
        )}
      </div>
      <input
        value={text}
        aria-label={`Search ${field.title}`}
        placeholder={`Search ${field.source}`}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => setText(event.target.value)}
      />
      {open && (options.length > 0 || error) && (
        <ul className="ref-options" role="listbox">
          {error && <li className="error">{error}</li>}
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({ value: option.id, refName: option.label });
                  setText("");
                  setOpen(false);
                }}
              >
                {option.label} <em>{option.id}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldInput({ field, cell, onChange }: { field: Field; cell: Cell; onChange: (cell: Cell) => void }) {
  if (field.type === "ref" || field.type === "select") return <RefPicker field={field} cell={cell} onChange={onChange} />;
  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        aria-label={field.title}
        checked={cell.value === "true"}
        onChange={(event) => onChange({ value: event.target.checked ? "true" : "false" })}
      />
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : "text"}
      aria-label={field.title}
      value={cell.value}
      onChange={(event) => onChange({ value: event.target.value })}
    />
  );
}

function LineGrid({
  sublist,
  lines,
  onChange,
}: {
  sublist: Sublist;
  lines: Line[];
  onChange?: (lines: Line[]) => void;
}) {
  const columns = lineColumns(sublist);
  const canClose = sublist.fields.some((field) => field.id === "isClosed");
  const editColumns = columns.filter((field) => field.id !== "isClosed" && field.id !== "amount");

  function set(index: number, id: string, cell: Cell) {
    onChange?.(lines.map((line, at) => (at === index ? { ...line, values: { ...line.values, [id]: cell } } : line)));
  }

  return (
    <section className="section">
      <h2>{sublist.title}</h2>
      <div className="table-wrap">
        <table className="line-grid">
          <thead>
            <tr>
              <th>Line</th>
              {(onChange ? editColumns : columns).map((field) => (
                <th key={field.id}>{field.title}</th>
              ))}
              {onChange && <th>{canClose ? "Closed" : ""}</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.line ?? `new-${index}`}>
                <td>{line.line ?? "New"}</td>
                {(onChange ? editColumns : columns).map((field) => (
                  <td key={field.id}>
                    {onChange && (line.line == null || field.id !== "item") ? (
                      <FieldInput field={field} cell={line.values[field.id] ?? { value: "" }} onChange={(cell) => set(index, field.id, cell)} />
                    ) : (
                      showCell(field, line.values[field.id])
                    )}
                  </td>
                ))}
                {onChange && (
                  <td>
                    {line.line == null ? (
                      <button className="linkish" type="button" onClick={() => onChange(lines.filter((_, at) => at !== index))}>
                        Remove
                      </button>
                    ) : canClose ? (
                      <input
                        type="checkbox"
                        aria-label={`Close line ${line.line}`}
                        checked={line.values.isClosed?.value === "true"}
                        onChange={(event) => set(index, "isClosed", { value: event.target.checked ? "true" : "false" })}
                      />
                    ) : null}
                  </td>
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td className="empty" colSpan={columns.length + 2}>
                  No lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {onChange && (
        <button className="quiet" type="button" onClick={() => onChange([...lines, { values: {} }])}>
          Add line
        </button>
      )}
      {onChange && <p className="status">NetSuite cannot delete a saved line through this connection. Close it instead.</p>}
    </section>
  );
}

// Lines to send: new lines with every filled value, saved lines with changed values and their line number.
function lineChanges(sublist: Sublist, lines: Line[]) {
  const out: Record<string, Wire>[] = [];
  for (const line of lines) {
    const data = changes(sublist.fields, line.values, line.line == null ? null : line.original || {});
    if (!Object.keys(data).length) continue;
    out.push(line.line == null ? data : { line: line.line, ...data });
  }
  return out;
}

type ShipLine = { orderLine: number; label: string; receive: boolean; quantity: string };

export function RecordsPage() {
  const [types, setTypes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [sublists, setSublists] = useState<Sublist[]>([]);
  const [recordId, setRecordId] = useState("");
  const [openId, setOpenId] = useState("");
  const [record, setRecord] = useState<ReadRecord | null>(null);
  const [draft, setDraft] = useState<Values>({});
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [actionArgs, setActionArgs] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [shipLines, setShipLines] = useState<ShipLine[]>([]);
  const [shipStatus, setShipStatus] = useState("C");
  const [clearShipMethod, setClearShipMethod] = useState(false);
  const [filePath, setFilePath] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [needle, setNeedle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const typeRef = useRef("");
  const shapeRef = useRef<Promise<{ fields: Field[]; sublists: Sublist[] }> | null>(null);

  useEffect(() => {
    let stop = false;
    const loadTypes = () =>
      api<{ types: string[] }>("/api/records/types")
        .then((body) => {
          if (!stop) setTypes(body.types);
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    loadTypes();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "records") loadTypes();
    };
    const onHash = () => {
      const next = hashParams();
      if (next.type) void openFromLink(next.type, next.id);
    };
    onHash();
    window.addEventListener("hn-refresh", onRefresh);
    window.addEventListener("hashchange", onHash);
    return () => {
      stop = true;
      window.removeEventListener("hn-refresh", onRefresh);
      window.removeEventListener("hashchange", onHash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setOpenId("");
    setRecord(null);
    setEditing(false);
    setCreating(false);
    setConfirm(false);
    setActions([]);
    setLines({});
  }

  function choose(next: string) {
    typeRef.current = next;
    setType(next);
    reset();
    setNotice("");
    setError(null);
    setFields([]);
    setSublists([]);
    const shape = api<{ fields: Field[]; sublists: Sublist[] }>(`/api/records/fields?type=${encodeURIComponent(next)}`);
    shapeRef.current = shape;
    shape
      .then((body) => {
        if (typeRef.current !== next) return;
        setFields(body.fields);
        setSublists(body.sublists);
      })
      .catch((reason: Error) => setError(reason.message));
    api<{ targets: string[] }>(`/api/records/transforms?type=${encodeURIComponent(next)}`)
      .then((body) => {
        if (typeRef.current !== next) return;
        setTargets(body.targets);
        setTarget(body.targets[0] || "");
      })
      .catch(() => setTargets([]));
    return shape;
  }

  async function openFromLink(nextType: string, id: string) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(nextType)) return;
    const shape = typeRef.current === nextType && shapeRef.current ? shapeRef.current : choose(nextType);
    if (!/^\d{1,12}$/.test(id)) return;
    setRecordId(id);
    try {
      const loaded = await shape;
      await openRecord(id, nextType, loaded.sublists);
    } catch (reason) {
      setError(errorText(reason, "The record did not open."));
    }
  }

  function startLines(read: ReadRecord | null, lists: Sublist[]) {
    const next: Record<string, Line[]> = {};
    for (const sublist of lists) {
      const found = read?.sublists.find((item) => item.id === sublist.id);
      if (!found) continue;
      next[sublist.id] = found.lines.map((cells) => {
        const values = valuesOf(sublist.fields, cells);
        return { line: Number(cells.line?.value), values, original: values };
      });
    }
    return next;
  }

  function startShipLines(read: ReadRecord) {
    const items = read.sublists.find((item) => item.id === "item")?.lines || [];
    setShipLines(
      items
        .filter((cells) => cells.isClosed?.value !== true)
        .map((cells) => ({
          orderLine: Number(cells.line?.value),
          label: `${cells.item?.refName || cells.item?.value || "Item"} × ${cells.quantity?.value ?? ""}`,
          receive: true,
          quantity: String(cells.quantity?.value ?? ""),
        }))
        .filter((line) => Number.isInteger(line.orderLine)),
    );
  }

  async function openRecord(id = recordId, recordType = type, lists = sublists) {
    if (!recordType || !id.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const [read, actionList] = await Promise.all([
        api<ReadRecord>(`/api/records?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(id.trim())}`),
        api<{ actions: Action[] }>(`/api/records/actions?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(id.trim())}`).catch(() => ({
          actions: [],
        })),
      ]);
      setRecord(read);
      setOpenId(read.id);
      setRecordId(read.id);
      setActions(actionList.actions);
      setLines(startLines(read, lists));
      startShipLines(read);
      setEditing(false);
      setCreating(false);
      setConfirm(false);
    } catch (reason) {
      setError(errorText(reason, "The record did not open."));
    } finally {
      setBusy(false);
    }
  }

  function goTo(created: Created, message: string) {
    setNotice(created.note ? `${message} ${created.note}` : message);
    const link = recordLink(created.type, created.id);
    if (location.hash === link) void openFromLink(created.type, created.id);
    else location.hash = link;
  }

  const readCells: Record<string, ReadCell> = Object.fromEntries((record?.fields || []).map((cell) => [cell.id, cell]));
  const original = record ? valuesOf(fields, readCells) : null;

  async function save() {
    if (!confirm || busy) return;
    const data = changes(fields, draft, creating ? null : original);
    const sublistData: Record<string, Record<string, Wire>[]> = {};
    for (const sublist of sublists) {
      const changed = lineChanges(sublist, lines[sublist.id] || []);
      if (changed.length) sublistData[sublist.id] = changed;
    }
    if (!Object.keys(data).length && !Object.keys(sublistData).length) {
      setError("Nothing to save.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<Created>("/api/records", {
        recordType: type,
        recordId: creating ? "" : openId,
        data,
        sublists: sublistData,
        confirm: true,
      });
      setConfirm(false);
      if (creating) goTo(result, `Created ${type} ${result.id}.`);
      else {
        setNotice("The record was saved.");
        await openRecord(openId);
      }
    } catch (reason) {
      setError(errorText(reason, "The record was not saved."));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: Action) {
    if (!confirm || !openId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const parameters = Object.fromEntries(
        action.parameters.map((name) => [name, actionArgs[`${action.id}.${name}`] || ""]).filter(([, value]) => value),
      );
      await postJson("/api/records/action", {
        recordType: type,
        recordId: openId,
        actionId: action.id,
        actionParameters: Object.keys(parameters).length ? parameters : undefined,
        confirm: true,
      });
      setNotice(`${action.label} ran.`);
      setConfirm(false);
      await openRecord(openId);
    } catch (reason) {
      setError(errorText(reason, "The action did not run."));
    } finally {
      setBusy(false);
    }
  }

  async function transform() {
    if (!confirm || !openId || !target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shipping = SHIPPING.has(target);
      const result = await postJson<Created>("/api/records/transform", {
        sourceRecordType: type,
        sourceRecordId: openId,
        targetRecordType: target,
        fulfill: shipping
          ? {
              lines: shipLines.map((line) => ({ orderLine: line.orderLine, receive: line.receive, quantity: Number(line.quantity) })),
              shipStatus,
              clearShipMethod,
            }
          : undefined,
        confirm: true,
      });
      setConfirm(false);
      goTo(result, `Created ${result.type} ${result.id} from ${type} ${openId}.`);
    } catch (reason) {
      setError(errorText(reason, "The record was not created."));
    } finally {
      setBusy(false);
    }
  }

  async function linkFile(detach: boolean) {
    if (!confirm || !openId || !filePath.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/records/file", { path: filePath.trim(), recordType: type, recordId: openId, detach, confirm: true });
      setNotice(detach ? "The file was detached." : "The file was attached.");
      setConfirm(false);
    } catch (reason) {
      setError(errorText(reason, "The file was not changed."));
    } finally {
      setBusy(false);
    }
  }

  const shown = types.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
  const formOpen = editing || creating;
  const match = (field: Field) => `${field.title} ${field.id}`.toLowerCase().includes(needle.trim().toLowerCase());
  const visibleFields = fields.filter(match).filter((field) => formOpen || (readCells[field.id] && readCells[field.id].value !== ""));
  const readLines = (sublist: Sublist): Line[] =>
    (record?.sublists.find((item) => item.id === sublist.id)?.lines || []).map((cells) => ({
      line: Number(cells.line?.value),
      values: valuesOf(sublist.fields, cells),
    }));
  const lineLists = sublists.filter((sublist) => sublist.id === "item" || record?.sublists.some((item) => item.id === sublist.id && item.lines.length));

  return (
    <div className="split-page">
      <header className="page-head">
        <div>
          <div className="kicker">Record types</div>
          <h1>Records</h1>
        </div>
        <RefreshButton label="records" onClick={() => refreshScope("records")} />
      </header>
      <p className="status">Pick a type, then open one by its internal id, or open a row from Orders, Quotes, Invoices, Customers or Items.</p>
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
                <strong>
                  {openId ? `${type} ${String(readCells.tranId?.value || readCells.entityId?.value || readCells.itemId?.value || openId)}` : type}
                </strong>
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
                      reset();
                      setCreating(true);
                      setDraft({});
                      setLines(Object.fromEntries(sublists.filter((sublist) => sublist.id === "item").map((sublist) => [sublist.id, [{ values: {} }]])));
                      setNotice("");
                    }}
                  >
                    New
                  </button>
                  {openId && !formOpen && (
                    <button
                      className="quiet"
                      type="button"
                      onClick={() => {
                        setDraft(original || {});
                        setLines(startLines(record, sublists));
                        setEditing(true);
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              {notice && <p className="status">{notice}</p>}
              {busy && <p className="status">Waiting for NetSuite. A write can take up to a minute.</p>}
              <label className="search-field">
                <Glyph icon={glyph.search} size={14} />
                <input className="search" value={needle} placeholder="Find a field" aria-label="Find a field" onChange={(event) => setNeedle(event.target.value)} />
              </label>
              {formOpen ? (
                <div className="record-form">
                  {visibleFields.map((field) => (
                    <label key={field.id}>
                      {field.title}
                      <FieldInput
                        field={field}
                        cell={draft[field.id] ?? { value: "" }}
                        onChange={(cell) => setDraft((current) => ({ ...current, [field.id]: cell }))}
                      />
                    </label>
                  ))}
                  <p className="status">Empty fields are left out. Emptying a saved field clears it.</p>
                </div>
              ) : (
                <dl className="field-grid">
                  {visibleFields.map((field) => (
                    <div key={field.id}>
                      <dt>{field.title}</dt>
                      <dd>{showCell(field, readCells[field.id])}</dd>
                    </div>
                  ))}
                  {openId && visibleFields.length === 0 && <p className="status">No filled fields match.</p>}
                </dl>
              )}
              {lineLists.map((sublist) =>
                formOpen ? (
                  <LineGrid
                    key={sublist.id}
                    sublist={sublist}
                    lines={lines[sublist.id] || []}
                    onChange={(next) => setLines((current) => ({ ...current, [sublist.id]: next }))}
                  />
                ) : openId ? (
                  <LineGrid key={sublist.id} sublist={sublist} lines={readLines(sublist)} />
                ) : null,
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
                      setConfirm(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {openId && !formOpen && actions.length > 0 && (
                <section className="section">
                  <h2>Actions</h2>
                  {actions.map((action) => (
                    <div key={action.id} className="filters">
                      {action.parameters.map((name) => (
                        <label key={name}>
                          {name}
                          <input
                            value={actionArgs[`${action.id}.${name}`] || ""}
                            onChange={(event) => setActionArgs((current) => ({ ...current, [`${action.id}.${name}`]: event.target.value }))}
                          />
                        </label>
                      ))}
                      <button className="quiet" type="button" disabled={!confirm || busy} onClick={() => runAction(action)}>
                        {action.label}
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {openId && !formOpen && targets.length > 0 && (
                <section className="section">
                  <h2>Turn this into</h2>
                  <div className="filters">
                    <label>
                      New record
                      <Pick label="New record" value={target} onChange={setTarget} options={targets.map((item) => ({ value: item, label: item }))} />
                    </label>
                  </div>
                  {SHIPPING.has(target) && (
                    <div className="ship-lines">
                      {shipLines.map((line, index) => (
                        <div key={line.orderLine} className="filters">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={line.receive}
                              onChange={(event) =>
                                setShipLines((current) => current.map((item, at) => (at === index ? { ...item, receive: event.target.checked } : item)))
                              }
                            />
                            Line {line.orderLine}: {line.label}
                          </label>
                          <label>
                            Quantity
                            <input
                              type="number"
                              min="0"
                              value={line.quantity}
                              disabled={!line.receive}
                              onChange={(event) =>
                                setShipLines((current) => current.map((item, at) => (at === index ? { ...item, quantity: event.target.value } : item)))
                              }
                            />
                          </label>
                        </div>
                      ))}
                      {target === "itemfulfillment" && (
                        <div className="filters">
                          <label>
                            Status
                            <select value={shipStatus} onChange={(event) => setShipStatus(event.target.value)}>
                              <option value="A">Picked</option>
                              <option value="B">Packed</option>
                              <option value="C">Shipped</option>
                            </select>
                          </label>
                          <label className="check">
                            <input type="checkbox" checked={clearShipMethod} onChange={(event) => setClearShipMethod(event.target.checked)} />
                            Leave the ship method empty. Use this when NetSuite asks for a UPS or FedEx account.
                          </label>
                        </div>
                      )}
                      <p className="status">Unchecked lines stay open on the order.</p>
                    </div>
                  )}
                  <button className="primary" type="button" disabled={!confirm || busy || !target} onClick={transform}>
                    Create {target}
                  </button>
                  <p className="status">NetSuite fills the new record from this one, then it opens here.</p>
                </section>
              )}
              {openId && !formOpen && (
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
