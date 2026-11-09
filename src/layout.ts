import { BLANK } from "./format";
import { useEffect, useState } from "react";

export type Span = 4 | 6 | 12;
export type RangeId = "all" | "month" | "quarter" | "year";
export type MeasureId = "count" | "sum" | "avg" | "min" | "max";
export type VisualId = "number" | "bar" | "pie" | "line";

export type TraceMetric = "avg" | "count" | "fail" | "slow";

export type PortletPref = {
  id: string;
  span: Span;
  hidden: boolean;
  range: RangeId;
  measure: MeasureId;
  visual: VisualId;
  trace?: TraceMetric;
};

export const traceCards: { id: string; label: string; metric: TraceMetric }[] = [
  { id: "trace-avg", label: "Average call time", metric: "avg" },
  { id: "trace-count", label: "Calls", metric: "count" },
  { id: "trace-fail", label: "Failed calls", metric: "fail" },
  { id: "trace-slow", label: "Slowest call", metric: "slow" },
];

export const portletCatalog = [
  { id: "customers", label: "Customers", href: "#/customers", kind: "metric", metric: "customers" },
  { id: "orders", label: "Open orders", href: "#/orders", kind: "metric", metric: "orders" },
  { id: "invoices", label: "Open invoices", href: "#/invoices", kind: "metric", metric: "invoices" },
  { id: "bills", label: "Open bills", href: "#/bills", kind: "metric", metric: "bills" },
  { id: "items", label: "Inventory items", href: "#/items", kind: "metric", metric: "items" },
  { id: "people", label: "People", href: "#/people", kind: "metric", metric: "people" },
  { id: "activity", label: "Transactions this year", href: "", kind: "activity", metric: "" },
] as const;

export type PortletId = (typeof portletCatalog)[number]["id"];

const key = "hn-portlets";

const ranges: RangeId[] = ["all", "month", "quarter", "year"];
const measures: MeasureId[] = ["count", "sum", "avg", "min", "max"];
const visuals: VisualId[] = ["number", "bar", "pie", "line"];

function asRange(value: unknown, fallback: RangeId): RangeId {
  return ranges.includes(value as RangeId) ? (value as RangeId) : fallback;
}

function asMeasure(value: unknown, fallback: MeasureId): MeasureId {
  return measures.includes(value as MeasureId) ? (value as MeasureId) : fallback;
}

function asVisual(value: unknown): VisualId {
  return visuals.includes(value as VisualId) ? (value as VisualId) : "number";
}

export function defaultLayout(): PortletPref[] {
  return portletCatalog.map((item) => ({
    id: item.id,
    span: item.id === "activity" ? 12 : 4,
    hidden: false,
    range: item.id === "activity" ? "year" : "all",
    measure: item.id === "orders" || item.id === "invoices" || item.id === "bills" ? "sum" : "count",
    visual: "number",
  }));
}

function tracePref(item: { id?: string; span?: unknown; hidden?: unknown }): PortletPref | null {
  const card = traceCards.find((entry) => entry.id === item?.id);
  if (!card) return null;
  const span: Span = item.span === 6 || item.span === 12 ? item.span : 4;
  return { id: card.id, span, hidden: Boolean(item.hidden), range: "all", measure: "count", visual: "number", trace: card.metric };
}

export function portletLabel(id: string) {
  return portletCatalog.find((item) => item.id === id)?.label || traceCards.find((item) => item.id === id)?.label || id;
}

export function traceFigure(entries: { name: string; ms: number; ok: boolean }[], metric: TraceMetric) {
  if (!entries.length) return { figure: BLANK, note: "No calls yet." };
  if (metric === "count") return { figure: String(entries.length), note: "Calls kept in this session." };
  if (metric === "fail") return { figure: String(entries.filter((entry) => !entry.ok).length), note: "Calls that failed." };
  if (metric === "slow") {
    const top = entries.reduce((best, entry) => (entry.ms > best.ms ? entry : best));
    return { figure: `${top.ms} ms`, note: top.name };
  }
  const avg = Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length);
  return { figure: `${avg} ms`, note: "Average time of the calls kept here." };
}

export function readLayout(): PortletPref[] {
  const defaults = defaultLayout();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    if (!Array.isArray(parsed)) return defaults;
    const known = new Map(defaults.map((item) => [item.id, item]));
    const next: PortletPref[] = [];
    for (const item of parsed) {
      const base = known.get(item?.id);
      if (!base) {
        const custom = tracePref(item);
        if (custom && !next.some((entry) => entry.id === custom.id)) next.push(custom);
        continue;
      }
      const span: Span = item.span === 6 || item.span === 12 ? item.span : 4;
      next.push({
        id: base.id,
        span,
        hidden: Boolean(item.hidden),
        range: asRange(item.range, base.range),
        measure: asMeasure(item.measure, base.measure),
        visual: asVisual(item.visual),
      });
      known.delete(base.id);
    }
    for (const item of known.values()) next.push(item);
    return next;
  } catch {
    return defaults;
  }
}

export function writeLayout(layout: PortletPref[]) {
  localStorage.setItem(key, JSON.stringify(layout));
}

export function resetLayout() {
  localStorage.removeItem(key);
  window.dispatchEvent(new Event("hn-portlets-reset"));
}

export function widthWord(span: Span) {
  if (span === 12) return "Full";
  if (span === 6) return "Half";
  return "Third";
}

export function useLayout() {
  const [layout, setLayout] = useState<PortletPref[]>(readLayout);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const onReset = () => setLayout(readLayout());
    window.addEventListener("hn-portlets-reset", onReset);
    return () => window.removeEventListener("hn-portlets-reset", onReset);
  }, []);

  function update(next: PortletPref[]) {
    setLayout(next);
    writeLayout(next);
  }

  function addTrace(id: string) {
    const card = traceCards.find((item) => item.id === id);
    if (!card || layout.some((item) => item.id === id)) return;
    update([...layout, { id: card.id, span: 4, hidden: false, range: "all", measure: "count", visual: "number", trace: card.metric }]);
  }

  function remove(id: string) {
    update(layout.filter((item) => item.id !== id || !item.trace));
  }

  return { layout, editing, setEditing, update, addTrace, remove };
}
