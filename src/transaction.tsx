import { useEffect, useState } from "react";
import { amount, dateLabel } from "./format";
import { explain, StatusPill, useLive } from "./lists";
import { Button, Lookup, SkeletonRecord } from "./load";
import { DatePick, Pick } from "./pick";
import { RefreshButton, refreshScope } from "./refresh";
import { api, postJson } from "./api";
import {
  changes,
  ConfirmCheck,
  errorText,
  partyScope,
  sideOf,
  FieldInput,
  LineGrid,
  lineChanges,
  recordLink,
  type Cell,
  type Created,
  type Field,
  type Line,
  type Sublist,
  type Values,
  type Wire,
} from "./records";

export const FLOW_LABELS: Record<string, string> = {
  estimate: "Quote",
  salesorder: "Sales order",
  invoice: "Invoice",
  itemfulfillment: "Fulfillment",
  customerpayment: "Customer payment",
  returnauthorization: "Return",
  purchaseorder: "Purchase order",
  itemreceipt: "Item receipt",
  vendorbill: "Bill",
  vendorpayment: "Bill payment",
};
const VENDOR_SIDE = new Set(["purchaseorder", "itemreceipt", "vendorbill", "vendorpayment"]);
const ORDERS = new Set(["salesorder", "purchaseorder"]);
const NEW_FIELDS = ["entity", "tranDate", "location", "memo"];

// The transaction page opens from #/transaction?type=salesorder&id=123, or ?type=estimate&new=1 for a blank one.
export function flowLink(type: string, id: string) {
  return FLOW_LABELS[type] ? `#/transaction?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}` : recordLink(type, id);
}

export function newLink(type: string) {
  return `#/transaction?type=${encodeURIComponent(type)}&new=1`;
}

type FlowLine = {
  line: number;
  item: { id: string; name: string } | null;
  description: string;
  quantity: number;
  rate: number | null;
  amount: number | null;
  closed: boolean;
  done: number;
  billed: number;
  remaining: number;
  location: { id: string; name: string } | null;
  tracking?: "serial" | "lot" | "";
  stock?: { id: string; name: string; available: number }[];
  available?: number | null;
};
type Step = {
  id: string;
  label: string;
  kind: "transform" | "ship" | "pay" | "close" | "update" | "action";
  target?: string;
  action?: string;
  data?: Record<string, Wire>;
};
type HeaderCell = { value: string | number | boolean; refName?: string };
type Linked = { id: string; type: string; number: string; date: string; status: string; direction: "next" | "previous" };
type Flow = {
  type: string;
  id: string;
  status: { id: string; name: string } | null;
  header: Record<string, HeaderCell>;
  unpaid: number | null;
  lines: FlowLine[];
  linked: Linked[];
  steps: Step[];
};

function hashParams() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return { type: params.get("type") || "", id: params.get("id") || "", isNew: params.get("new") === "1" };
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function externalId(type: string) {
  return `hns-wf-${type}-${crypto.randomUUID()}`;
}

function show(cell?: HeaderCell) {
  if (!cell || cell.value === "" || cell.value == null) return "—";
  return String(cell.refName || cell.value);
}

export function TransactionPage() {
  const [params, setParams] = useState(hashParams);
  useEffect(() => {
    const onHash = () => setParams(hashParams());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (!FLOW_LABELS[params.type]) return <p className="error">This page opens quotes, orders, invoices, fulfillments, payments, purchase orders, receipts and bills.</p>;
  if (params.isNew) return <NewTransaction key={params.type} type={params.type} />;
  return <FlowView key={`${params.type}:${params.id}`} type={params.type} id={params.id} />;
}

function FlowView({ type, id }: { type: string; id: string }) {
  const path = `/api/flow?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  const live = useLive<Flow>(/^\d{1,12}$/.test(id) ? path : null);
  const [step, setStep] = useState<Step | null>(null);
  const [notice, setNotice] = useState("");
  const flow = live.data;
  const h = flow?.header || {};
  const party = VENDOR_SIDE.has(type) ? "Vendor" : "Customer";
  const isOrder = ORDERS.has(type);

  if (!flow && live.loading) {
    return (
      <>
        <Lookup label={`Opening this ${FLOW_LABELS[type].toLowerCase()}.`} />
        <SkeletonRecord />
      </>
    );
  }
  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">{FLOW_LABELS[type]}</div>
          <h1>{show(h.tranId) === "—" ? `${FLOW_LABELS[type]} ${id}` : show(h.tranId)}</h1>
        </div>
        <div className="page-tools">
          {flow?.status && <StatusPill value={flow.status.name} />}
          <a className="quiet" href={recordLink(type, id)}>
            All fields
          </a>
          <RefreshButton label={FLOW_LABELS[type]} scope={path} busy={live.loading && Boolean(flow)} />
        </div>
      </header>
      {live.error && <p className="error">{explain(live.error)}</p>}
      {notice && <p className="status">{notice}</p>}
      {flow && (
        <>
          <dl className="field-grid">
            <div>
              <dt>{party}</dt>
              <dd>{show(h.entity)}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{dateLabel(String(h.tranDate?.value ?? ""))}</dd>
            </div>
            {h.location && (
              <div>
                <dt>Location</dt>
                <dd>{show(h.location)}</dd>
              </div>
            )}
            {h.shipMethod && (
              <div>
                <dt>Ship method</dt>
                <dd>{show(h.shipMethod)}</dd>
              </div>
            )}
            <div>
              <dt>Memo</dt>
              <dd>{show(h.memo)}</dd>
            </div>
            {h.total && (
              <div>
                <dt>Total</dt>
                <dd>{amount(Number(h.total.value), show(h.currency))}</dd>
              </div>
            )}
            {flow.unpaid != null && flow.unpaid !== 0 && (
              <div>
                <dt>Open amount</dt>
                <dd>{amount(flow.unpaid, show(h.currency))}</dd>
              </div>
            )}
          </dl>

          <section className="section">
            <h2>Next steps</h2>
            {flow.steps.length === 0 ? (
              <p>{flow.status ? `Nothing to do here at status ${flow.status.name}.` : "Nothing to do here."}</p>
            ) : (
              <div className="actions">
                {flow.steps.map((item) => (
                  <button key={item.id} className={step?.id === item.id ? "primary" : "quiet"} type="button" onClick={() => setStep(step?.id === item.id ? null : item)}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {step && (
              <StepForm
                key={step.id}
                flow={flow}
                step={step}
                onDone={(message, next) => {
                  setStep(null);
                  setNotice(message);
                  if (next) location.hash = flowLink(next.type, next.id);
                  else refreshScope(path);
                }}
              />
            )}
          </section>

          <section className="section">
            <h2>Lines</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Item</th>
                    <th className="num">Quantity</th>
                    {isOrder && <th className="num">{type === "purchaseorder" ? "Received" : "Fulfilled"}</th>}
                    {isOrder && <th className="num">Billed</th>}
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                    {isOrder && <th>Closed</th>}
                  </tr>
                </thead>
                <tbody>
                  {flow.lines.map((line) => (
                    <tr key={line.line}>
                      <td>{line.line}</td>
                      <td>{line.item?.name || line.description || "—"}</td>
                      <td className="num">{line.quantity}</td>
                      {isOrder && <td className="num">{line.done}</td>}
                      {isOrder && <td className="num">{line.billed}</td>}
                      <td className="num">{line.rate == null ? "—" : amount(line.rate)}</td>
                      <td className="num">{line.amount == null ? "—" : amount(line.amount)}</td>
                      {isOrder && <td>{line.closed ? "Yes" : "No"}</td>}
                    </tr>
                  ))}
                  {flow.lines.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={8}>
                        No item lines.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {flow.linked.length > 0 && (
            <section className="section">
              <h2>Linked records</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Link</th>
                      <th>Number</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.linked.map((row) => (
                      <tr key={`${row.direction}:${row.id}`}>
                        <td>{row.direction === "previous" ? "Made from" : "Turned into"}</td>
                        <td>
                          <a href={flowLink(row.type, row.id)}>{row.number}</a>
                        </td>
                        <td>{FLOW_LABELS[row.type] || row.type}</td>
                        <td>{dateLabel(row.date)}</td>
                        <td>{row.status ? <StatusPill value={row.status.replace(/^[^:]*:\s*/, "")} /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

type ShipPick = {
  line: number;
  label: string;
  on: boolean;
  quantity: string;
  numbers: { id: string; quantity: number }[];
  source: FlowLine;
};
type Number = { id: string; number: string; available: number };

// Serial or lot numbers in stock at the line's location. Serial items take one number per unit.
function NumberPick({ line, quantity, value, onChange }: { line: FlowLine; quantity: number; value: ShipPick["numbers"]; onChange: (value: ShipPick["numbers"]) => void }) {
  const [numbers, setNumbers] = useState<Number[] | null>(null);
  const [error, setError] = useState("");
  const location = line.location?.id || "";
  useEffect(() => {
    if (!line.item || !location) return;
    api<{ numbers: Number[] }>(`/api/flow/numbers?item=${encodeURIComponent(line.item.id)}&location=${encodeURIComponent(location)}`)
      .then((body) => setNumbers(body.numbers))
      .catch((reason: Error) => setError(reason.message));
  }, [line.item, location]);
  if (error) return <p className="error">{error}</p>;
  if (!numbers) return <Lookup label={`Finding ${line.tracking} numbers at ${line.location?.name || "this location"}.`} />;
  if (!numbers.length) return <p className="status">No {line.tracking} numbers are in stock at {line.location?.name}.</p>;
  if (line.tracking === "lot") {
    return (
      <label>
        Lot
        <Pick
          label={`Lot for line ${line.line}`}
          value={value[0]?.id || ""}
          onChange={(id) => onChange([{ id, quantity }])}
          options={numbers.map((item) => ({ value: item.id, label: `${item.number} (${item.available} available)` }))}
        />
      </label>
    );
  }
  const chosen = new Set(value.map((item) => item.id));
  return (
    <fieldset className="numbers">
      <legend>
        Serial numbers: pick {quantity} ({chosen.size} picked)
      </legend>
      {numbers.map((item) => (
        <label key={item.id} className="check">
          <input
            type="checkbox"
            checked={chosen.has(item.id)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, { id: item.id, quantity: 1 }] : value.filter((entry) => entry.id !== item.id))
            }
          />
          {item.number}
        </label>
      ))}
    </fieldset>
  );
}

// Says when a line's location has too little stock, and offers to move the order to a location that has it.
function StockNote({ line, quantity, onMove, busy }: { line: FlowLine; quantity: number; onMove: (location: { id: string; name: string }) => void; busy: boolean }) {
  if (line.available == null || line.available >= quantity) return null;
  const other = line.stock?.find((row) => row.id !== line.location?.id && row.available >= quantity);
  return (
    <div className="stock-note">
      <p className="error">
        Only {line.available} available at {line.location?.name || "the order's location"}.
        {other ? ` ${other.name} has ${other.available}.` : " No other location has enough."}
      </p>
      {other && (
        <Button className="quiet" busy={busy} onClick={() => onMove(other)}>
          Ship the order from {other.name}
        </Button>
      )}
    </div>
  );
}

const SHIP_STATUSES = [
  { value: "A", label: "Picked" },
  { value: "B", label: "Packed" },
  { value: "C", label: "Shipped" },
];

function StepForm({ flow, step, onDone }: { flow: Flow; step: Step; onDone: (message: string, next?: Created) => void }) {
  const isShip = step.kind === "ship";
  const open = flow.lines.filter((line) => !line.closed && (!isShip || line.remaining > 0));
  const [picks, setPicks] = useState<ShipPick[]>(() =>
    open.map((line) => ({
      line: line.line,
      label: `${line.item?.name || line.description || "Item"} (${isShip ? `${line.remaining} open` : `${line.quantity} ordered`})`,
      on: step.kind !== "close",
      quantity: String(isShip ? line.remaining : line.quantity),
      numbers: [],
      source: line,
    })),
  );
  const [memo, setMemo] = useState("");
  const [shipStatus, setShipStatus] = useState("C");
  const [clearShipMethod, setClearShipMethod] = useState(/ups/i.test(show(flow.header.shipMethod)));
  const [payAmount, setPayAmount] = useState(flow.unpaid == null ? "" : String(flow.unpaid));
  const [payDate, setPayDate] = useState(today);
  const [account, setAccount] = useState<Cell>({ value: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountField: Field = { id: "account", title: "Account", type: "ref", source: "account" };
  const target = step.target ? FLOW_LABELS[step.target] || step.target : "";
  const fulfill = step.target === "itemfulfillment";

  function update(index: number, change: Partial<ShipPick>) {
    setPicks((current) => current.map((item, at) => (at === index ? { ...item, ...change } : item)));
  }

  async function attempt(work: () => Promise<void>) {
    if (!confirm || busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason, "NetSuite did not make the change."));
    } finally {
      setBusy(false);
    }
  }

  function moveOrder(location: { id: string; name: string }) {
    if (!confirm) {
      setError("Tick the box below first. Moving the order changes it in NetSuite.");
      return;
    }
    void attempt(async () => {
      await postJson("/api/records", { recordType: flow.type, recordId: flow.id, data: { location: { id: location.id } }, confirm: true });
      onDone(`The order now ships from ${location.name}. Open Fulfill again.`);
    });
  }

  const run = () =>
    attempt(async () => {
      const source = { recordType: flow.type, recordId: flow.id, confirm: true };
      if (step.kind === "transform" || step.kind === "ship" || step.kind === "pay") {
        const data: Record<string, Wire> = {};
        if (memo.trim()) data.memo = memo.trim();
        if (step.kind === "pay") {
          data.tranDate = payDate;
          if (account.value) data.account = { id: account.value };
          if (step.target === "customerpayment") {
            const value = Number(payAmount);
            if (!(value > 0)) throw new Error("Enter a payment amount above 0.");
            data.payment = value;
          }
        }
        if (isShip) {
          for (const pick of picks) {
            if (pick.on && pick.source.tracking && fulfill && pick.numbers.reduce((sum, item) => sum + item.quantity, 0) !== Number(pick.quantity)) {
              throw new Error(`Line ${pick.line} needs ${pick.quantity} ${pick.source.tracking} number${Number(pick.quantity) === 1 ? "" : "s"}.`);
            }
          }
        }
        const created = await postJson<Created>("/api/records/transform", {
          sourceRecordType: flow.type,
          sourceRecordId: flow.id,
          targetRecordType: step.target,
          externalId: externalId(step.target || "record"),
          data,
          fulfill: isShip
            ? {
                lines: picks.map((pick) => ({
                  orderLine: pick.line,
                  receive: pick.on,
                  quantity: Number(pick.quantity),
                  ...(fulfill && pick.numbers.length ? { numbers: pick.numbers } : {}),
                })),
                shipStatus,
                clearShipMethod,
              }
            : undefined,
          confirm: true,
        });
        onDone(`Created ${target.toLowerCase()} ${created.id}.${created.note ? ` ${created.note}` : ""}`, created);
        return;
      }
      if (step.kind === "close") {
        const lines = picks.filter((pick) => pick.on).map((pick) => ({ line: pick.line, isClosed: true }));
        if (!lines.length) throw new Error("Pick at least one line to close.");
        await postJson("/api/records", { ...source, sublists: { item: lines } });
        onDone(`Closed ${lines.length} line${lines.length === 1 ? "" : "s"}.`);
        return;
      }
      if (step.kind === "update") {
        await postJson("/api/records", { ...source, data: step.data });
        onDone(`${step.label} is done.`);
        return;
      }
      await postJson("/api/records/action", { ...source, actionId: step.action });
      onDone(`${step.label} is done.`);
    });

  return (
    <div className="step-form">
      {(isShip || step.kind === "close") && (
        <div className="ship-lines">
          {picks.map((pick, index) => (
            <div key={pick.line} className="ship-line">
              <div className="filters">
                <label className="check">
                  <input type="checkbox" checked={pick.on} onChange={(event) => update(index, { on: event.target.checked })} />
                  Line {pick.line}: {pick.label}
                  {pick.source.location && isShip ? ` from ${pick.source.location.name}` : ""}
                </label>
                {isShip && (
                  <label>
                    Quantity
                    <input type="number" min="0" value={pick.quantity} disabled={!pick.on} onChange={(event) => update(index, { quantity: event.target.value, numbers: [] })} />
                  </label>
                )}
              </div>
              {fulfill && pick.on && <StockNote line={pick.source} quantity={Number(pick.quantity)} onMove={moveOrder} busy={busy} />}
              {fulfill && pick.on && pick.source.tracking && (pick.source.available ?? 0) > 0 && (
                <NumberPick line={pick.source} quantity={Number(pick.quantity)} value={pick.numbers} onChange={(numbers) => update(index, { numbers })} />
              )}
            </div>
          ))}
          {picks.length === 0 && <p className="status">No open lines.</p>}
          {isShip && <p className="status">Unchecked lines stay open on the order.</p>}
          {step.kind === "close" && <p className="status">A closed line stays on the order but is not fulfilled or billed.</p>}
        </div>
      )}
      <div className="filters">
        {fulfill && (
          <label>
            Status
            <Pick label="Fulfillment status" value={shipStatus} onChange={setShipStatus} options={SHIP_STATUSES} />
          </label>
        )}
        {step.kind === "pay" && step.target === "customerpayment" && (
          <label>
            Amount
            <input type="number" min="0" step="0.01" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} />
          </label>
        )}
        {step.kind === "pay" && (
          <>
            <label>
              Payment date
              <DatePick label="Payment date" value={payDate} onChange={setPayDate} />
            </label>
            <label>
              Account
              <FieldInput field={accountField} cell={account} onChange={setAccount} />
            </label>
          </>
        )}
        {(step.kind === "transform" || isShip || step.kind === "pay") && (
          <label>
            Memo
            <input value={memo} aria-label="Memo" onChange={(event) => setMemo(event.target.value)} />
          </label>
        )}
      </div>
      {fulfill && (
        <label className="check">
          <input type="checkbox" checked={clearShipMethod} onChange={(event) => setClearShipMethod(event.target.checked)} />
          Leave the ship method empty. NetSuite needs this for UPS orders in this account.
        </label>
      )}
      <ConfirmCheck checked={confirm} onChange={setConfirm} />
      {error && <p className="error">{error}</p>}
      <Button className="primary" busy={busy} disabled={!confirm} onClick={run}>
        {target ? `Create ${target.toLowerCase()}` : step.label}
      </Button>
    </div>
  );
}

function NewTransaction({ type }: { type: string }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [sublist, setSublist] = useState<Sublist | null>(null);
  const [draft, setDraft] = useState<Values>({ tranDate: { value: today() } });
  const [lines, setLines] = useState<Line[]>([{ values: {} }]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ fields: Field[]; sublists: Sublist[] }>(`/api/records/fields?type=${encodeURIComponent(type)}`)
      .then((shape) => {
        setFields(NEW_FIELDS.map((id) => shape.fields.find((field) => field.id === id)).filter((field): field is Field => Boolean(field)));
        setSublist(shape.sublists.find((item) => item.id === "item") || null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [type]);

  async function create() {
    if (!confirm || busy || !sublist) return;
    setBusy(true);
    setError("");
    try {
      const data = changes(fields, draft, null);
      const item = lineChanges(sublist, lines);
      if (!data.entity) throw new Error(`Pick a ${VENDOR_SIDE.has(type) ? "vendor" : "customer"}.`);
      if (!item.length) throw new Error("Add at least one line with an item.");
      const created = await postJson<Created>("/api/records", {
        recordType: type,
        data,
        sublists: { item },
        externalId: externalId(type),
        confirm: true,
      });
      location.hash = flowLink(type, created.id);
    } catch (reason) {
      setError(errorText(reason, "The record was not created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker">New</div>
          <h1>New {FLOW_LABELS[type].toLowerCase()}</h1>
        </div>
      </header>
      {!sublist && !error && <Lookup label="Reading the form from NetSuite." />}
      {sublist && (
        <>
          <div className="record-form">
            {fields.map((field) => (
              <label key={field.id}>
                {field.id === "entity" ? (VENDOR_SIDE.has(type) ? "Vendor" : "Customer") : field.title}
                {field.id === "tranDate" ? (
                  <DatePick label="Date" value={draft.tranDate?.value || ""} onChange={(value) => setDraft((current) => ({ ...current, tranDate: { value } }))} />
                ) : (
                  <FieldInput
                    field={field}
                    scope={partyScope(fields, draft)}
                    cell={draft[field.id] ?? { value: "" }}
                    onChange={(cell) => setDraft((current) => ({ ...current, [field.id]: cell }))}
                  />
                )}
              </label>
            ))}
          </div>
          <LineGrid sublist={sublist} lines={lines} onChange={setLines} side={sideOf(type)} />
          <ConfirmCheck checked={confirm} onChange={setConfirm}>
            I mean to run this. It creates a record in NetSuite.
          </ConfirmCheck>
          <div className="actions">
            <Button className="primary" busy={busy} disabled={!confirm} onClick={create}>
              Create {FLOW_LABELS[type].toLowerCase()}
            </Button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
