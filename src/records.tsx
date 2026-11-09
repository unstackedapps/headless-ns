import { useEffect, useRef, useState, type ReactNode } from "react";
import { Glyph, glyph } from "./icons";
import { Combobox, Pick, type Option } from "./pick";
import { Button, Lookup, SkeletonRecord } from "./load";
import { FilterRail } from "./rail";
import { commonTypes, LatestRecords, pushRecent, RecordFinder, typeLabel } from "./finder";
import { DataTable } from "./table";
import { BLANK } from "./format";
import { RefreshButton, refreshScope } from "./refresh";
import { api, postJson } from "./api";
import { flowLink } from "./transaction";

export type Field = {
  id: string;
  title: string;
  type: "string" | "number" | "boolean" | "ref" | "select";
  source?: string;
  options?: string[];
};
export type Sublist = { id: string; title: string; fields: Field[] };
export type Cell = { value: string; refName?: string };
export type Values = Record<string, Cell>;
type ReadCell = { id: string; value: string | number | boolean; refName?: string };
type ReadRecord = { id: string; fields: ReadCell[]; sublists: { id: string; lines: Record<string, ReadCell>[] }[] };
type Action = { id: string; label: string; parameters: string[] };
export type Line = { line?: number; values: Values; original?: Values };
export type Created = { id: string; type: string; note?: string };
export type Wire = string | number | boolean | null | { id: string };

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
export function changes(fields: Field[], current: Values, original: Values | null) {
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
  if (!cell || cell.value === "" || cell.value == null) return BLANK;
  if (cell.refName) return cell.refName;
  if (field?.type === "boolean" || typeof cell.value === "boolean") return String(cell.value) === "true" ? "Yes" : "No";
  return String(cell.value);
}

function lineColumns(sublist: Sublist) {
  const have = new Map(sublist.fields.map((field) => [field.id, field]));
  const picked = LINE_COLUMNS.map((id) => have.get(id)).filter((field): field is Field => Boolean(field));
  return picked.length ? picked : sublist.fields.slice(0, 5);
}

// Some sublists (packages, for one) have no line number, so their lines cannot be edited by number.
function lineNumber(cells: Record<string, ReadCell>) {
  const value = Number(cells.line?.value);
  return cells.line && Number.isInteger(value) ? value : undefined;
}

export function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export type Scope = { party: "customer" | "vendor"; id: string };

function lookup(source: string, scope?: Scope | null) {
  return (text: string, signal: AbortSignal) => {
    const params = new URLSearchParams({ source, q: text });
    if (scope?.id) {
      params.set("party", scope.party);
      params.set("partyId", scope.id);
    }
    return api<{ options: Option[] }>(`/api/records/lookup?${params}`, { signal }).then((body) => body.options);
  };
}

// One input for any field: text, number, checkbox, a select from a fixed list, or a searchable reference.
// `scope` limits a location search to the subsidiary of the chosen customer or vendor.
export function FieldInput({ field, cell, onChange, scope }: { field: Field; cell: Cell; onChange: (cell: Cell) => void; scope?: Scope | null }) {
  if (field.type === "select") {
    return (
      <Pick
        label={field.title}
        value={cell.value}
        onChange={(value) => onChange({ value })}
        options={(field.options || []).map((option) => ({ value: option, label: option === cell.value && cell.refName ? `${option} · ${cell.refName}` : option }))}
      />
    );
  }
  if (field.type === "ref" && field.source) {
    return (
      <Combobox
        label={field.title}
        placeholder={`Search ${field.title.toLowerCase()}`}
        value={cell.value ? { id: cell.value, label: cell.refName || `id ${cell.value}` } : null}
        search={lookup(field.source, field.source === "location" ? scope : null)}
        onChange={(option) => onChange({ value: option.id, refName: option.label })}
      />
    );
  }
  if (field.type === "ref") {
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

const PURCHASE_TYPES = new Set(["purchaseorder", "vendorbill", "itemreceipt", "vendorcredit", "vendorreturnauthorization"]);
const SALE_TYPES = new Set(["estimate", "salesorder", "invoice", "cashsale", "creditmemo", "returnauthorization", "opportunity"]);

// Which price an item line starts from: the base price on sales, the purchase price on purchases.
export function sideOf(recordType: string): "sale" | "purchase" | undefined {
  return SALE_TYPES.has(recordType) ? "sale" : PURCHASE_TYPES.has(recordType) ? "purchase" : undefined;
}

// The chosen customer or vendor, so a location search shows only locations in its subsidiary.
export function partyScope(fields: Field[], values: Values): Scope | null {
  const source = fields.find((field) => field.id === "entity")?.source;
  const id = values.entity?.value;
  return id && (source === "customer" || source === "vendor") ? { party: source, id } : null;
}

type ItemDefaults = { rate: number | null; description: string; rateLabel: string };

// The checkbox every write asks for before it runs.
export function ConfirmCheck({ checked, onChange, children = "I mean to run this. It changes NetSuite." }: { checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

// Sublist lines. With onChange, saved lines can be edited by line number and new lines added.
// `side` turns on item defaults: picking an item fills rate and description from its base or purchase price.
export function LineGrid({
  sublist,
  lines,
  onChange,
  side,
}: {
  sublist: Sublist;
  lines: Line[];
  onChange?: (lines: Line[]) => void;
  side?: "sale" | "purchase";
}) {
  const columns = lineColumns(sublist);
  const canClose = sublist.fields.some((field) => field.id === "isClosed");
  const editColumns = columns.filter((field) => field.id !== "isClosed" && field.id !== "amount");
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [defaults, setDefaults] = useState<Record<number, ItemDefaults | "loading">>({});

  function set(index: number, id: string, cell: Cell) {
    onChange?.(lines.map((line, at) => (at === index ? { ...line, values: { ...line.values, [id]: cell } } : line)));
    if (id !== "item" || !side || !cell.value) return;
    setDefaults((current) => ({ ...current, [index]: "loading" }));
    api<ItemDefaults>(`/api/records/item-defaults?id=${encodeURIComponent(cell.value)}&side=${side}`)
      .then((found) => {
        setDefaults((current) => ({ ...current, [index]: found }));
        const fill: Values = {};
        if (found.rate != null) fill.rate = { value: String(found.rate) };
        if (found.description) fill.description = { value: found.description };
        const current = linesRef.current[index];
        if (current && !current.values.quantity?.value && sublist.fields.some((field) => field.id === "quantity")) fill.quantity = { value: "1" };
        onChange?.(linesRef.current.map((line, at) => (at === index ? { ...line, values: { ...line.values, ...fill } } : line)));
      })
      .catch(() => setDefaults((current) => ({ ...current, [index]: { rate: null, description: "", rateLabel: "Price" } })));
  }

  function hint(index: number) {
    const found = defaults[index];
    if (!found) return null;
    if (found === "loading") return <Lookup label="Reading the item's price." />;
    return <span className="field-hint">{found.rate == null ? `No ${found.rateLabel.toLowerCase()} in NetSuite.` : `${found.rateLabel} ${found.rate}`}</span>;
  }

  return (
    <section className="section">
      <h2>{sublist.title}</h2>
      <DataTable
        label={sublist.title}
        className="line-grid"
        rows={lines}
        rowKey={(line, index) => line.line ?? `row-${index}`}
        empty="No lines."
        columns={[
          { key: "line", label: "Line", cell: (line) => line.line ?? (onChange && !line.original ? "New" : BLANK) },
          ...(onChange ? editColumns : columns).map((field) => ({
            key: field.id,
            label: field.title,
            cell: (line: Line, index: number) =>
              onChange && !(line.original && (line.line == null || field.id === "item")) ? (
                <>
                  <FieldInput field={field} cell={line.values[field.id] ?? { value: "" }} onChange={(cell) => set(index, field.id, cell)} />
                  {field.id === "rate" && hint(index)}
                </>
              ) : (
                showCell(field, line.values[field.id])
              ),
          })),
          ...(onChange
            ? [
                {
                  key: "close",
                  label: canClose && lines.some((line) => line.original) ? "Closed" : "",
                  cell: (line: Line, index: number) =>
                    !line.original ? (
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
                    ) : null,
                },
              ]
            : []),
        ]}
      />
      {onChange && (
        <div className="grid-tools">
          <button className="quiet" type="button" onClick={() => onChange([...lines, { values: {} }])}>
            Add line
          </button>
          {lines.some((line) => line.original) && <p className="status">NetSuite cannot delete a saved line through this connection. Close it instead.</p>}
        </div>
      )}
    </section>
  );
}

// Lines to send: new lines with every filled value, saved lines with changed values and their line number.
export function lineChanges(sublist: Sublist, lines: Line[]) {
  const out: Record<string, Wire>[] = [];
  for (const line of lines) {
    if (line.original && line.line == null) continue;
    const data = changes(sublist.fields, line.values, line.line == null ? null : line.original || {});
    if (!Object.keys(data).length) continue;
    out.push(line.line == null ? data : { line: line.line, ...data });
  }
  return out;
}

export function RecordsPage() {
  const [types, setTypes] = useState<string[] | null>(null);
  const [shapeLoading, setShapeLoading] = useState(false);
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
    const loadTypes = (fresh = false) =>
      api<{ types: string[] }>(`/api/records/types${fresh ? "?fresh=1" : ""}`)
        .then((body) => {
          if (!stop) setTypes(body.types);
        })
        .catch((reason: Error) => {
          if (!stop) setError(reason.message);
        });
    loadTypes();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "records") loadTypes(scope === "records");
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

  function choose(next: string, keepNotice = false) {
    typeRef.current = next;
    setType(next);
    reset();
    if (!keepNotice) setNotice("");
    setError(null);
    setFields([]);
    setSublists([]);
    setShapeLoading(true);
    const shape = api<{ fields: Field[]; sublists: Sublist[] }>(`/api/records/fields?type=${encodeURIComponent(next)}`);
    shapeRef.current = shape;
    shape
      .then((body) => {
        if (typeRef.current !== next) return;
        setFields(body.fields);
        setSublists(body.sublists);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => {
        if (typeRef.current === next) setShapeLoading(false);
      });
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
    const shape = typeRef.current === nextType && shapeRef.current ? shapeRef.current : choose(nextType, true);
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
        return { line: lineNumber(cells), values, original: values };
      });
    }
    return next;
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
      const named = read.fields.find((cell) => ["tranId", "entityId", "itemId"].includes(cell.id) && cell.value !== "");
      pushRecent({ type: recordType, id: read.id, label: String(named?.value ?? read.id) });
      setRecordId(read.id);
      setActions(actionList.actions);
      setLines(startLines(read, lists));
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
      const result = await postJson<Created>("/api/records/transform", {
        sourceRecordType: type,
        sourceRecordId: openId,
        targetRecordType: target,
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

  const formOpen = editing || creating;
  const match = (field: Field) => `${field.title} ${field.id}`.toLowerCase().includes(needle.trim().toLowerCase());
  const visibleFields = fields.filter(match).filter((field) => formOpen || (readCells[field.id] && readCells[field.id].value !== ""));
  const readLines = (sublist: Sublist): Line[] =>
    (record?.sublists.find((item) => item.id === sublist.id)?.lines || []).map((cells) => ({
      line: lineNumber(cells),
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
      <p className="status">Find a record by number, name or email. Or pick a type on the left, then pick a record or type its internal id.</p>
      <RecordFinder
        onOpen={(nextType, id) => {
          const link = recordLink(nextType, id);
          if (location.hash === link) void openFromLink(nextType, id);
          else location.hash = link;
        }}
      />
      {error && <p className="error">{error}</p>}
      <div className="split">
        <FilterRail
          label="Filter types"
          placeholder="Filter types"
          items={[
            ...Object.keys(commonTypes)
              .filter((name) => types?.includes(name))
              .map((name) => ({ key: name, title: commonTypes[name], note: name })),
            ...(types || []).filter((name) => !commonTypes[name]).map((name) => ({ key: name, title: name })),
          ]}
          selected={type}
          onPick={(name) => choose(name)}
          loading={!types && !error}
          empty="This role can see no record types."
        />
        <div className="split-main">
          {!type && <p className="split-empty">Pick a record type on the left.</p>}
          {type && (
            <>
              <div className="pane-head">
                <strong>
                  {openId ? `${typeLabel(type)} ${String(readCells.tranId?.value || readCells.entityId?.value || readCells.itemId?.value || openId)}` : typeLabel(type)}
                </strong>
                <div className="filters">
                  <label>
                    Internal id
                    <input value={recordId} inputMode="numeric" aria-label="Internal id" onChange={(event) => setRecordId(event.target.value)} />
                  </label>
                  <Button className="primary" busy={busy} disabled={!recordId.trim()} onClick={() => openRecord()}>
                    Open
                  </Button>
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
              {!openId && !creating && !busy && <LatestRecords type={type} onOpen={(id) => openRecord(id)} />}
              {busy && <Lookup label="Waiting for NetSuite. A write can take up to a minute." />}
              {(openId || formOpen) && (
                <label className="search-field">
                  <Glyph icon={glyph.search} size={14} />
                  <input className="search" value={needle} placeholder="Find a field" aria-label="Find a field" onChange={(event) => setNeedle(event.target.value)} />
                </label>
              )}
              {shapeLoading ? (
                <SkeletonRecord />
              ) : formOpen ? (
                <div className="record-form">
                  {visibleFields.map((field) => (
                    <label key={field.id}>
                      {field.title}
                      <FieldInput
                        field={field}
                        scope={partyScope(fields, draft)}
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
                    side={sideOf(type)}
                  />
                ) : openId ? (
                  <LineGrid key={sublist.id} sublist={sublist} lines={readLines(sublist)} />
                ) : null,
              )}
              {(formOpen || openId) && (
                <ConfirmCheck checked={confirm} onChange={setConfirm} />
              )}
              {formOpen && (
                <div className="actions">
                  <Button className="primary" busy={busy} disabled={!confirm} onClick={save}>
                    {creating ? "Create" : "Save"}
                  </Button>
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
                      <Button className="quiet" busy={busy} disabled={!confirm} onClick={() => runAction(action)}>
                        {action.label}
                      </Button>
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
                  {SHIPPING.has(target) ? (
                    <p className="status">
                      Fulfill and receive from the <a href={flowLink(type, openId)}>transaction page</a>. It checks stock, locations and serial numbers first.
                    </p>
                  ) : (
                    <>
                      <Button className="primary" busy={busy} disabled={!confirm || !target} onClick={transform}>
                        Create {target}
                      </Button>
                      <p className="status">NetSuite fills the new record from this one, then it opens here.</p>
                    </>
                  )}
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
                    <Button className="quiet" busy={busy} disabled={!confirm || !filePath.trim()} onClick={() => linkFile(false)}>
                      Attach
                    </Button>
                    <Button className="quiet" busy={busy} disabled={!confirm || !filePath.trim()} onClick={() => linkFile(true)}>
                      Detach
                    </Button>
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
