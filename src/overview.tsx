import { useCallback, useEffect, useState } from "react";
import { amount, BLANK, count } from "./format";
import { SeriesChart } from "./chart";
import { Glyph, glyph } from "./icons";
import { Pick } from "./pick";
import { portletCatalog, portletLabel, traceCards, traceFigure, useLayout, widthWord, type MeasureId, type PortletPref, type RangeId, type Span, type VisualId } from "./layout";
import { Lookup, SkeletonPortlets } from "./load";
import { markBusy, refreshMs, refreshScope, RefreshButton, RefreshIntervalSelect, useRefreshInterval } from "./refresh";
import { api } from "./api";
import { explain } from "./lists";
import { DataTable } from "./table";
import { PageHead } from "./head";

type MoneyRow = {
  currency: string;
  n: number;
  amount: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
};
type Metric = { n?: number; rows?: MoneyRow[]; error?: string };
type Overview = {
  fetchedAt: string;
  tokenExpiresAt: string | null;
  source: string;
  year: number;
  metrics: Record<string, Metric>;
};
type Activity = { year: number; rows: { type: string; n: number }[] };

const typeLabels: Record<string, string> = {
  CustInvc: "Invoice",
  SalesOrd: "Sales order",
  CashSale: "Cash sale",
  CustCred: "Credit memo",
  CustPymt: "Customer payment",
  VendBill: "Bill",
  VendPymt: "Bill payment",
  VendCred: "Vendor credit",
  ItemShip: "Fulfillment",
  ItemRcpt: "Item receipt",
  Journal: "Journal",
  CustRfnd: "Customer refund",
  Deposit: "Deposit",
  DepAppl: "Deposit application",
  PurchOrd: "Purchase order",
  TrnfrOrd: "Transfer order",
  RtnAuth: "Return",
  InvAdjst: "Inventory adjustment",
  InvTrnfr: "Inventory transfer",
  ExpRept: "Expense report",
  Check: "Check",
  Estimate: "Quote",
};

const rangeLabel: Record<RangeId, string> = {
  all: "All dates",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

const moneyIds = new Set(["orders", "invoices", "bills"]);

function rowValue(row: MoneyRow, measure: MeasureId) {
  if (measure === "count") return row.n;
  if (measure === "avg") return row.avg ?? (row.n ? (row.amount ?? 0) / row.n : 0);
  if (measure === "min") return row.min ?? 0;
  if (measure === "max") return row.max ?? 0;
  return row.amount ?? 0;
}

function metricView(metric: Metric | undefined, measure: MeasureId) {
  if (metric?.error) return { figure: BLANK, note: explain(metric.error), failed: true, points: [] as { label: string; value: number }[] };
  if (metric?.rows) {
    const points = metric.rows.map((row) => ({ label: row.currency || "Amount", value: rowValue(row, measure) }));
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const single = points.length === 1 ? metric.rows[0] : null;
    const figure =
      points.length > 1
        ? count(metric.rows.reduce((sum, row) => sum + row.n, 0))
        : measure === "count" || single?.amount == null
          ? count(total)
          : amount(points[0]?.value ?? 0, single?.currency || "");
    const note = points.length > 1 ? "By currency" : measure === "count" ? "Open records" : `${count(single?.n ?? 0)} open`;
    return { figure, note, failed: false, points };
  }
  return { figure: count(metric?.n ?? 0), note: "Active", failed: false, points: [] as { label: string; value: number }[] };
}

function useRangeData<T>(path: string, ranges: string[]) {
  const key = [...new Set(ranges)].sort().join(",");
  const [bundle, setBundle] = useState<Record<string, { data: T | null; error: string | null; loading: boolean }>>({});
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(
    async (range: string, quiet = false) => {
      if (!quiet) {
        setBundle((current) => ({
          ...current,
          [range]: { data: current[range]?.data ?? null, error: null, loading: true },
        }));
      }
      try {
        const body = await api<T>(`${path}?range=${range}`);
        setBundle((current) => ({ ...current, [range]: { data: body, error: null, loading: false } }));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Could not refresh.";
        setBundle((current) => ({
          ...current,
          [range]: { data: current[range]?.data ?? null, error: message, loading: false },
        }));
      }
    },
    [path],
  );

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "dashboard") setGeneration((value) => value + 1);
    };
    window.addEventListener("hn-refresh", onRefresh);
    return () => window.removeEventListener("hn-refresh", onRefresh);
  }, []);

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    const controller = new AbortController();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      markBusy(false);
    };
    markBusy(true);
    setBundle((current) => {
      const next = { ...current };
      for (const range of list) next[range] = { data: current[range]?.data ?? null, error: null, loading: true };
      return next;
    });
    let pending = list.length;
    const finishOne = () => {
      pending -= 1;
      if (pending <= 0) done();
    };
    for (const range of list) {
      api<T>(`${path}?range=${range}`, { signal: controller.signal, signInOn401: true })
        .then((body) => {
          setBundle((current) => ({ ...current, [range]: { data: body, error: null, loading: false } }));
        })
        .catch((reason: Error) => {
          if (reason.name === "AbortError") return;
          setBundle((current) => ({
            ...current,
            [range]: { data: current[range]?.data ?? null, error: reason.message, loading: false },
          }));
        })
        .finally(finishOne);
    }
    return () => {
      controller.abort();
      done();
    };
  }, [path, key, generation]);

  return [bundle, reload] as const;
}

type TraceEntry = { name: string; ms: number; ok: boolean };

function useTrace(enabled: boolean) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback((signal?: AbortSignal) => {
    if (!enabled) return Promise.resolve();
    setLoading(true);
    return api<{ entries?: TraceEntry[] }>("/api/trace", { signal })
      .then((body) => {
        setEntries(Array.isArray(body.entries) ? body.entries : []);
        setError(null);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [enabled]);

  useEffect(() => {
    const controller = new AbortController();
    const onRefresh = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scope === "dashboard") reload(controller.signal);
    };
    window.addEventListener("hn-refresh", onRefresh);
    reload(controller.signal);
    return () => {
      controller.abort();
      window.removeEventListener("hn-refresh", onRefresh);
    };
  }, [reload]);

  return { entries, error, loading, reload };
}

export function OverviewPage() {
  const { layout, editing, setEditing, update, addTrace, remove } = useLayout();
  const trace = useTrace(layout.some((item) => item.trace));
  const [adding, setAdding] = useState(false);
  const overviewRanges = ["all", ...layout.filter((item) => moneyIds.has(item.id)).map((item) => item.range)];
  const activityRanges = layout.filter((item) => item.id === "activity").map((item) => item.range);
  const [overviews, reloadOverview] = useRangeData<Overview>("/api/overview", overviewRanges);
  const [activities, reloadActivity] = useRangeData<Activity>("/api/activity", activityRanges.length ? activityRanges : ["year"]);
  const overview = overviews.all ?? { data: null, error: null, loading: true };
  const activity = activities[layout.find((item) => item.id === "activity")?.range || "year"] ?? { data: null, error: null, loading: true };
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [refreshEvery] = useRefreshInterval();
  const [spinId, setSpinId] = useState<string | null>(null);

  useEffect(() => {
    const ms = refreshMs(refreshEvery);
    if (!ms) return;
    const timer = window.setInterval(() => refreshScope("dashboard"), ms);
    return () => window.clearInterval(timer);
  }, [refreshEvery]);

  function move(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...layout];
    const from = next.findIndex((item) => item.id === dragId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update(next);
  }

  function nudge(id: string, step: number) {
    const next = [...layout];
    const index = next.findIndex((item) => item.id === id);
    const to = index + step;
    if (index < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    update(next);
  }

  function patch(id: string, change: Partial<PortletPref>) {
    update(layout.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  function cycle(id: string) {
    const order: Span[] = [4, 6, 12];
    const current = layout.find((item) => item.id === id);
    const span = order[(Math.max(0, order.indexOf(current?.span || 4)) + 1) % order.length];
    patch(id, { span });
  }

  const hidden = layout.filter((item) => item.hidden);

  function editTools(pref: PortletPref, index: number, removable: boolean) {
    return (
      <div className="portlet-tools">
        <span
          className="drag"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", pref.id);
            event.dataTransfer.effectAllowed = "move";
            setDragId(pref.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
        >
          <Glyph icon={glyph.move} size={14} />
          Move
        </span>
        <button className="quiet" type="button" disabled={index === 0} onClick={() => nudge(pref.id, -1)}>
          <Glyph icon={glyph.up} size={14} />
          Up
        </button>
        <button className="quiet" type="button" disabled={index === layout.length - 1} onClick={() => nudge(pref.id, 1)}>
          <Glyph icon={glyph.down} size={14} />
          Down
        </button>
        <button className="quiet" type="button" onClick={() => cycle(pref.id)} aria-label={`Width ${widthWord(pref.span)}`}>
          {widthWord(pref.span)}
        </button>
        <button className="quiet" type="button" onClick={() => patch(pref.id, { hidden: !pref.hidden })}>
          <Glyph icon={pref.hidden ? glyph.eye : glyph.eyeOff} size={14} />
          {pref.hidden ? "Show" : "Hide"}
        </button>
        {removable && (
          <button className="quiet" type="button" onClick={() => remove(pref.id)}>
            Remove
          </button>
        )}
      </div>
    );
  }

  const firstLoad = overview.loading && !overview.data && !overview.error;

  return (
    <>
      <PageHead title="Overview">
        <div className="page-tools">
          <RefreshIntervalSelect />
          <button className={editing ? "quiet on" : "quiet"} type="button" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>
            <Glyph icon={glyph.arrange} />
            {editing ? "Done" : "Arrange"}
          </button>
          <button className={adding ? "quiet on" : "quiet"} type="button" aria-expanded={adding} onClick={() => setAdding((value) => !value)}>
            <Glyph icon={glyph.plus} />
            Add
          </button>
        </div>
      </PageHead>
      {adding && (
        <div className="add-menu">
          {traceCards.filter((card) => !layout.some((item) => item.id === card.id)).length === 0 && (
            <p className="status">Every trace card is already on the dashboard.</p>
          )}
          {traceCards
            .filter((card) => !layout.some((item) => item.id === card.id))
            .map((card) => (
              <button key={card.id} className="quiet" type="button" onClick={() => addTrace(card.id)}>
                {card.label}
              </button>
            ))}
        </div>
      )}
      {editing && <p className="status">Drag a card to move it. You can hide any card and remove the ones you added. This browser keeps the layout.</p>}
      {overview.error && <p className="error">{overview.error}</p>}
      {firstLoad ? (
        <SkeletonPortlets />
      ) : (
      <section className={overview.loading ? "portlets is-loading" : "portlets"} aria-label="Home cards">
          {layout.map((pref, index) => {
            if (pref.hidden && !editing) return null;
            const card = portletCatalog.find((item) => item.id === pref.id);
            if (pref.trace) {
              const shown = traceFigure(trace.entries, pref.trace);
              const className = ["portlet", editing ? "is-editing" : "", pref.hidden ? "is-hidden" : "", overId === pref.id ? "is-over" : "", spinId === pref.id ? "is-loading" : ""].filter(Boolean).join(" ");
              return (
                <section
                  key={pref.id}
                  className={className}
                  data-span={pref.span}
                  onDragOver={(event) => {
                    if (!editing) return;
                    event.preventDefault();
                    setOverId(pref.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    move(pref.id);
                    setOverId(null);
                  }}
                >
                  <header>
                    <span>{portletLabel(pref.id)}</span>
                    <div className="portlet-end">
                      {!editing && (
                        <RefreshButton
                          label={portletLabel(pref.id)}
                          busy={spinId === pref.id}
                          onClick={() => {
                            setSpinId(pref.id);
                            trace.reload().finally(() => setSpinId((current) => (current === pref.id ? null : current)));
                          }}
                        />
                      )}
                      {editing && editTools(pref, index, true)}
                    </div>
                  </header>
                  <div className="body">
                    {trace.loading && trace.entries.length === 0 ? <Lookup label="Reading the trace." /> : <strong>{shown.figure}</strong>}
                    {trace.error && <p className="error">{trace.error}</p>}
                    <em>{shown.note}</em>
                  </div>
                </section>
              );
            }
            if (!card) return null;
            const source = moneyIds.has(pref.id) ? overviews[pref.range] ?? overview : overview;
            const metric = card.metric ? metricView(source.data?.metrics[card.metric], pref.measure) : null;
            const activityCard = card.kind === "activity" ? activities[pref.range] ?? activity : null;
            const activityPoints =
              activityCard?.data?.rows.map((row) => ({ label: typeLabels[row.type] || row.type, value: row.n })) ?? [];
            const activityValues = activityPoints.map((point) => point.value);
            const activityTotal = activityValues.reduce((sum, value) => sum + value, 0);
            const activityFigure =
              pref.measure === "avg"
                ? count(activityValues.length ? activityTotal / activityValues.length : 0)
                : pref.measure === "min"
                  ? count(activityValues.length ? Math.min(...activityValues) : 0)
                  : pref.measure === "max"
                    ? count(activityValues.length ? Math.max(...activityValues) : 0)
                    : count(activityTotal);
            const chartable = card.kind === "activity" ? activityPoints.length > 1 : (metric?.points.length ?? 0) > 1;
            const visual: VisualId = chartable ? pref.visual : "number";
            const sharedLoading = card.kind === "activity" ? Boolean(activityCard?.loading && activityCard.data) : Boolean(source.loading && source.data);
            const reloading = spinId === pref.id || (spinId === null && sharedLoading);
            const className = [
              "portlet",
              !editing && card.href ? "is-link" : "",
              editing ? "is-editing" : "",
              pref.hidden ? "is-hidden" : "",
              overId === pref.id ? "is-over" : "",
              reloading ? "is-loading" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const tools = editing ? editTools(pref, index, false) : null;
            const dated = card.kind === "activity" || moneyIds.has(pref.id);
            const measures: MeasureId[] = card.kind === "activity" || moneyIds.has(pref.id) ? ["count", "sum", "avg", "min", "max"] : ["count"];
            const config = editing ? (
              <div className="portlet-config">
                <label>
                  Dates
                  <Pick
                    label={`${card.label} dates`}
                    value={dated ? pref.range : "all"}
                    disabled={!dated}
                    onChange={(next) => patch(pref.id, { range: next as RangeId })}
                    options={(dated ? (Object.keys(rangeLabel) as RangeId[]) : (["all"] as RangeId[])).map((id) => ({
                      value: id,
                      label: dated ? rangeLabel[id] : "Current",
                    }))}
                  />
                </label>
                <label>
                  Figure
                  <Pick
                    label={`${card.label} figure`}
                    value={measures.includes(pref.measure) ? pref.measure : "count"}
                    onChange={(next) => patch(pref.id, { measure: next as MeasureId })}
                    options={measures.map((id) => ({
                      value: id,
                      label: id === "count" ? "Count" : id === "sum" ? "Sum" : id === "avg" ? "Average" : id === "min" ? "Minimum" : "Maximum",
                    }))}
                  />
                </label>
                <label>
                  Chart
                  <Pick
                    label={`${card.label} chart`}
                    value={visual}
                    disabled={!chartable}
                    onChange={(next) => patch(pref.id, { visual: next as VisualId })}
                    options={[
                      { value: "number", label: "Number" },
                      ...(chartable
                        ? [
                            { value: "bar", label: "Bar" },
                            { value: "pie", label: "Pie" },
                            { value: "line", label: "Line" },
                          ]
                        : []),
                    ]}
                  />
                </label>
              </div>
            ) : null;
            const points = card.kind === "activity" ? activityPoints : metric?.points ?? [];
            const shown =
              visual === "number" ? null : <SeriesChart kind={visual} points={points.filter((point) => point.label)} />;
            const body =
              card.kind === "activity" ? (
                <div className="body">
                  {config}
                  <strong>{activityFigure}</strong>
                  <p className="status">{rangeLabel[pref.range]}</p>
                  {activityCard?.error && <p className="error">{activityCard.error}</p>}
                  {activityCard?.loading && !activityCard.data && <Lookup label="Looking up transactions." />}
                  {shown}
                  {visual === "number" && activityCard?.data && (
                    <DataTable
                      label="Transactions by type"
                      rows={activityCard.data.rows}
                      rowKey={(row) => row.type}
                      empty="No transactions in this range."
                      columns={[
                        { key: "type", label: "Type", cell: (row) => typeLabels[row.type] || row.type },
                        { key: "count", label: "Count", num: true, cell: (row) => count(row.n) },
                      ]}
                    />
                  )}
                </div>
              ) : (
                <div className="body">
                  {config}
                  {visual === "number" && <strong>{metric?.figure}</strong>}
                  {shown}
                  {metric?.note && <em className={metric.failed ? "fail" : ""}>{metric.note}</em>}
                </div>
              );
            const inner = (
              <>
                <header>
                  <span>{card.kind === "activity" ? `Transactions, ${rangeLabel[pref.range].toLowerCase()}` : card.label}</span>
                  <div className="portlet-end">
                    {!editing && (
                      <RefreshButton
                        label={card.label}
                        busy={spinId === pref.id}
                        onClick={() => {
                          const range = card.kind === "activity" ? pref.range : moneyIds.has(pref.id) ? pref.range : "all";
                          const run = card.kind === "activity" ? reloadActivity : reloadOverview;
                          setSpinId(pref.id);
                          run(range, true).finally(() => setSpinId((current) => (current === pref.id ? null : current)));
                        }}
                      />
                    )}
                    {tools}
                  </div>
                </header>
                {body}
              </>
            );
            return (
              <section
                key={pref.id}
                className={className}
                data-span={pref.span}
                onClick={(event) => {
                  if (editing || !card.href) return;
                  const target = event.target as HTMLElement;
                  if (target.closest("button, a, select, label, input")) return;
                  location.hash = card.href;
                }}
                onDragOver={(event) => {
                  if (!editing) return;
                  event.preventDefault();
                  setOverId(pref.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  move(pref.id);
                  setOverId(null);
                }}
              >
                {inner}
              </section>
            );
          })}
      </section>
      )}
      {editing && hidden.length > 0 && (
        <p className="status">
          {hidden.length} {hidden.length === 1 ? "card is" : "cards are"} hidden. Use Show on a card to bring it back.
        </p>
      )}
    </>
  );
}
