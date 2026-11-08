import { useEffect, useState } from "react";
import { amount, dateLabel } from "./format";
import { explain, StatusPill, useLive } from "./lists";
import { Button, Lookup, SkeletonRecord } from "./load";
import { editRow, numbersProblem, pickedTotal, pickSerial, serialFull, serialRows, type Picked } from "./serials";
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
const PAYMENTS = new Set(["customerpayment", "vendorpayment"]);
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
  picked?: number;
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
  number: string;
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

// SO628 reads as is; a bare running number such as a bill's 415 reads "Bill 415".
export function flowTitle(type: string, id: string, number?: string) {
  if (!number) return `${FLOW_LABELS[type] || type} ${id}`;
  return /^\d+$/.test(number) ? `${FLOW_LABELS[type] || type} ${number}` : number;
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
          <h1>{flowTitle(type, id, flow?.number)}</h1>
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
            {flow.linked
              .filter((row) => row.type === "itemfulfillment" && /picked|packed/i.test(row.status))
              .map((row) => (
                <p key={row.id} className="status">
                  <a href={flowLink(row.type, row.id)}>{row.number}</a> is {row.status.replace(/^[^:]*:\s*/, "").toLowerCase()}. Open it to pack or ship it.
                </p>
              ))}
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
                onChanged={() => refreshScope(path, true)}
              />
            )}
          </section>

          {(flow.lines.length > 0 || !PAYMENTS.has(type)) && (
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
                      {isOrder && (
                        <td className="num">
                          {line.done}
                          {line.picked ? <span className="field-hint">{line.picked} on a fulfillment not shipped yet</span> : null}
                        </td>
                      )}
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
          )}

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
  numbers: Picked[];
  source: FlowLine;
};
type Number = { id: string; number: string; available: number };

// Serial or lot numbers for one line. A fulfillment picks numbers in stock at the line's location;
// a receipt types new ones. Serial items take one number per unit; lots take any split of the quantity.
function NumberPick({
  line,
  quantity,
  receiving,
  value,
  onChange,
}: {
  line: FlowLine;
  quantity: number;
  receiving: boolean;
  value: Picked[];
  onChange: (value: Picked[]) => void;
}) {
  const [numbers, setNumbers] = useState<Number[] | null>(receiving ? [] : null);
  const [error, setError] = useState("");
  const location = line.location?.id || "";
  useEffect(() => {
    if (receiving || !line.item || !location) return;
    api<{ numbers: Number[] }>(`/api/flow/numbers?item=${encodeURIComponent(line.item.id)}&location=${encodeURIComponent(location)}`)
      .then((body) => setNumbers(body.numbers))
      .catch((reason: Error) => setError(reason.message));
  }, [line.item, location, receiving]);
  if (error) return <p className="error">{error}</p>;
  if (!numbers) return <Lookup label={`Finding ${line.tracking} numbers at ${line.location?.name || "this location"}.`} />;
  if (!receiving && !numbers.length) return <p className="status">No {line.tracking} numbers are in stock at {line.location?.name}.</p>;

  if (line.tracking === "serial" && receiving) {
    const rows = serialRows(value, quantity);
    return (
      <fieldset className="numbers">
        <legend>{rows.length === 1 ? "Serial number: enter 1" : `Serial numbers: enter ${rows.length}`}</legend>
        {rows.map((row, at) => (
          <input
            key={at}
            aria-label={`Serial ${at + 1} for line ${line.line}`}
            value={row.number || ""}
            onChange={(event) => onChange(editRow(rows, at, { number: event.target.value }))}
          />
        ))}
      </fieldset>
    );
  }

  if (line.tracking === "serial") {
    const chosen = new Set(value.map((item) => item.id));
    const single = quantity === 1;
    const full = serialFull(value, quantity);
    return (
      <fieldset className="numbers">
        <legend>{single ? "Serial number: pick 1" : `Serial numbers: pick ${quantity} (${chosen.size} picked)`}</legend>
        {numbers.map((item) => (
          <label key={item.id} className="check">
            <input
              type={single ? "radio" : "checkbox"}
              name={`serial-${line.line}`}
              checked={chosen.has(item.id)}
              disabled={!single && full && !chosen.has(item.id)}
              onChange={(event) => onChange(pickSerial(value, item.id, event.target.checked, quantity))}
            />
            {item.number}
          </label>
        ))}
      </fieldset>
    );
  }

  // Lots: one row per lot, starting with one row for the whole quantity.
  const rows: Picked[] = value.length ? value : [{ quantity }];
  const left = quantity - pickedTotal(rows);
  return (
    <fieldset className="numbers lots">
      <legend>
        Lots: {pickedTotal(rows)} of {quantity} {receiving ? "entered" : "picked"}
      </legend>
      {rows.map((row, at) => (
        <div key={at} className="filters">
          <label>
            Lot
            {receiving ? (
              <input aria-label={`Lot ${at + 1} for line ${line.line}`} value={row.number || ""} onChange={(event) => onChange(editRow(rows, at, { number: event.target.value }))} />
            ) : (
              <Pick
                label={`Lot ${at + 1} for line ${line.line}`}
                value={row.id || ""}
                onChange={(id) => onChange(editRow(rows, at, { id }))}
                options={numbers.map((item) => ({ value: item.id, label: `${item.number} (${item.available} available)` }))}
              />
            )}
          </label>
          <label>
            Lot quantity
            <input
              type="number"
              min="0"
              aria-label={`Lot ${at + 1} quantity for line ${line.line}`}
              value={String(row.quantity)}
              onChange={(event) => onChange(editRow(rows, at, { quantity: Number(event.target.value) }))}
            />
          </label>
          {rows.length > 1 && (
            <button className="quiet" type="button" onClick={() => onChange(rows.filter((_, other) => other !== at))}>
              Remove lot
            </button>
          )}
        </div>
      ))}
      <button className="quiet" type="button" onClick={() => onChange([...rows, { quantity: Math.max(left, 0) }])}>
        Add another lot
      </button>
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

// One line of a step form: a checkbox naming the line and a number for it (quantity or amount).
function PickRow({
  checked,
  onCheck,
  label,
  field,
  fieldLabel,
  value,
  onValue,
  step,
  children,
}: {
  checked: boolean;
  onCheck: (on: boolean) => void;
  label: string;
  field?: string;
  fieldLabel?: string;
  value?: string;
  onValue?: (value: string) => void;
  step?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ship-line">
      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} />
          {label}
        </label>
        {field && onValue && (
          <label>
            {field}
            <input type="number" min="0" step={step} aria-label={fieldLabel} value={value} disabled={!checked} onChange={(event) => onValue(event.target.value)} />
          </label>
        )}
      </div>
      {children}
    </div>
  );
}

type BillPick = { doc: string; label: string; on: boolean; amount: string };
type VendorBills = { bills: { id: string; number: string; due: string; currency: string; unpaid: number | null }[] };

// Open bills of the bill's vendor, with this bill ticked for its open amount.
function useBillsToPay(flow: Flow, active: boolean) {
  const [bills, setBills] = useState<BillPick[]>(() =>
    active ? [{ doc: flow.id, label: `${flowTitle(flow.type, flow.id, flow.number)}, ${amount(flow.unpaid, show(flow.header.currency))} open`, on: true, amount: String(flow.unpaid ?? "") }] : [],
  );
  const [error, setError] = useState("");
  const vendor = String(flow.header.entity?.value ?? "");
  useEffect(() => {
    if (!active || !/^\d+$/.test(vendor)) return;
    api<VendorBills>(`/api/vendors/${vendor}`)
      .then((body) =>
        // Keep this bill's row as the user left it and replace the rest, so a second load adds nothing twice.
        setBills((current) => [
          ...current.filter((bill) => bill.doc === flow.id),
          ...body.bills
            .filter((bill) => bill.id !== flow.id && (bill.unpaid ?? 0) > 0)
            .map((bill) => ({
              doc: bill.id,
              label: `${flowTitle("vendorbill", bill.id, bill.number)}, ${amount(bill.unpaid, bill.currency)} open${bill.due ? `, due ${dateLabel(bill.due)}` : ""}`,
              on: false,
              amount: String(bill.unpaid ?? ""),
            })),
        ]),
      )
      .catch((reason: Error) => setError(`Other open bills did not load. ${reason.message}`));
  }, [active, vendor, flow.id]);
  return { bills, setBills, error };
}

const SHIP_STATUSES = [
  { value: "A", label: "Picked" },
  { value: "B", label: "Packed" },
  { value: "C", label: "Shipped" },
];

function StepForm({
  flow,
  step,
  onDone,
  onChanged,
}: {
  flow: Flow;
  step: Step;
  onDone: (message: string, next?: Created) => void;
  onChanged: () => void;
}) {
  const isShip = step.kind === "ship";
  // A purchase order bills what was received and not billed yet, line by line.
  const billing = flow.type === "purchaseorder" && step.target === "vendorbill";
  const payingBills = step.target === "vendorpayment";
  const open = flow.lines.filter((line) => !line.closed && (!isShip || line.remaining > 0));
  const toBill = (line: FlowLine) => Math.max(line.done - line.billed, 0);
  const [picks, setPicks] = useState<ShipPick[]>(() =>
    open.map((line) => ({
      line: line.line,
      label: `${line.item?.name || line.description || "Item"} (${
        isShip ? `${line.remaining} open` : billing ? `${line.done} received, ${line.billed} billed` : `${line.quantity} ordered`
      })`,
      on: billing ? toBill(line) > 0 : step.kind !== "close",
      quantity: String(isShip ? line.remaining : billing ? toBill(line) : line.quantity),
      numbers: [],
      source: line,
    })),
  );
  const pay = useBillsToPay(flow, payingBills);
  const [memo, setMemo] = useState("");
  const [shipStatus, setShipStatus] = useState("C");
  const [clearShipMethod, setClearShipMethod] = useState(/ups/i.test(show(flow.header.shipMethod)));
  const [payAmount, setPayAmount] = useState(flow.unpaid == null ? "" : String(flow.unpaid));
  const [payDate, setPayDate] = useState(today);
  const [account, setAccount] = useState<Cell>({ value: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moved, setMoved] = useState("");
  const accountField: Field = { id: "account", title: "Account", type: "ref", source: "account" };

  // When the order reloads (after a move, say), take the new location and stock but keep what the user picked.
  useEffect(() => {
    setPicks((current) =>
      current.map((pick) => {
        const source = flow.lines.find((line) => line.line === pick.line);
        if (!source) return pick;
        const sameLocation = source.location?.id === pick.source.location?.id;
        return { ...pick, source, numbers: sameLocation ? pick.numbers : [] };
      }),
    );
  }, [flow.lines]);
  const target = step.target ? FLOW_LABELS[step.target] || step.target : "";
  const fulfill = step.target === "itemfulfillment";
  const receiving = step.target === "itemreceipt";

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
      // Show the new location at once; the reload then fills in NetSuite's own figures.
      setPicks((current) =>
        current.map((pick) => {
          const there = pick.source.stock?.find((row) => row.id === location.id);
          return { ...pick, numbers: [], source: { ...pick.source, location, available: there?.available ?? 0 } };
        }),
      );
      setMoved(`The order now ships from ${location.name}.`);
      onChanged();
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
            if (!pick.on || !pick.source.tracking || !(fulfill || receiving)) continue;
            const problem = numbersProblem(pick.numbers, Number(pick.quantity), pick.source.tracking, pick.line, receiving);
            if (problem) throw new Error(problem);
          }
        }
        const apply = payingBills ? pay.bills.filter((bill) => bill.on).map((bill) => ({ doc: bill.doc, amount: Number(bill.amount) })) : undefined;
        if (apply && !apply.length) throw new Error("Pick at least one bill to pay.");
        if (apply?.some((bill) => !(bill.amount > 0))) throw new Error("Enter an amount above 0 for each bill you pay.");
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
                  ...(pick.source.tracking && pick.numbers.length ? { numbers: pick.numbers } : {}),
                })),
                shipStatus,
                clearShipMethod,
              }
            : undefined,
          bill: billing ? { lines: picks.map((pick) => ({ orderLine: pick.line, quantity: pick.on ? Number(pick.quantity) : 0 })) } : undefined,
          apply,
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
      {(isShip || billing || step.kind === "close") && (
        <div className="ship-lines">
          {picks.map((pick, index) => (
            <PickRow
              key={pick.line}
              checked={pick.on}
              onCheck={(on) => update(index, { on })}
              label={`Line ${pick.line}: ${pick.label}${pick.source.location && isShip ? ` from ${pick.source.location.name}` : ""}`}
              field={isShip || billing ? "Quantity" : undefined}
              value={pick.quantity}
              onValue={(quantity) => update(index, { quantity, numbers: [] })}
            >
              {fulfill && pick.on && <StockNote line={pick.source} quantity={Number(pick.quantity)} onMove={moveOrder} busy={busy} />}
              {pick.on && pick.source.tracking && (receiving || (fulfill && (pick.source.available ?? 0) > 0)) && (
                <NumberPick
                  line={pick.source}
                  quantity={Number(pick.quantity)}
                  receiving={receiving}
                  value={pick.numbers}
                  onChange={(numbers) => update(index, { numbers })}
                />
              )}
            </PickRow>
          ))}
          {picks.length === 0 && <p className="status">No open lines.</p>}
          {isShip && <p className="status">Unchecked lines stay open on the order.</p>}
          {billing && <p className="status">Each line starts at what was received and not billed yet. An unchecked line goes on the bill at 0.</p>}
          {step.kind === "close" && <p className="status">A closed line stays on the order but is not fulfilled or billed.</p>}
        </div>
      )}
      {payingBills && (
        <div className="ship-lines">
          {pay.bills.map((bill, index) => (
            <PickRow
              key={bill.doc}
              checked={bill.on}
              onCheck={(on) => pay.setBills((current) => current.map((item, at) => (at === index ? { ...item, on } : item)))}
              label={bill.label}
              field="Amount"
              fieldLabel={`Amount for ${bill.label.split(",")[0]}`}
              step="0.01"
              value={bill.amount}
              onValue={(value) => pay.setBills((current) => current.map((item, at) => (at === index ? { ...item, amount: value } : item)))}
            />
          ))}
          {pay.error && <p className="error">{pay.error}</p>}
          <p className="status">
            Pays {amount(pay.bills.filter((bill) => bill.on).reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0), show(flow.header.currency))}. Lower an amount to pay part of a bill.
          </p>
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
      {moved && <p className="status">{moved}</p>}
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
        const party = VENDOR_SIDE.has(type) ? "Vendor" : "Customer";
        setFields(
          NEW_FIELDS.map((id) => shape.fields.find((field) => field.id === id))
            .filter((field): field is Field => Boolean(field))
            .map((field) => (field.id === "entity" ? { ...field, title: party } : field)),
        );
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
                {field.title}
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
