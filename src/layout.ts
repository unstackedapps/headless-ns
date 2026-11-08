import { useEffect, useState } from "react";

export type Span = 4 | 6 | 12;
export type RangeId = "all" | "month" | "quarter" | "year";
export type MeasureId = "count" | "sum" | "avg" | "min" | "max";
export type VisualId = "number" | "bar" | "pie" | "line";

export type PortletPref = {
  id: string;
  span: Span;
  hidden: boolean;
  range: RangeId;
  measure: MeasureId;
  visual: VisualId;
};

export const portletCatalog = [
  { id: "customers", label: "Customers", href: "#/customers", kind: "metric", metric: "customers" },
  { id: "orders", label: "Open orders", href: "#/orders", kind: "metric", metric: "orders" },
  { id: "invoices", label: "Open invoices", href: "#/invoices", kind: "metric", metric: "invoices" },
  { id: "bills", label: "Open bills", href: "#/bills", kind: "metric", metric: "bills" },
  { id: "items", label: "Inventory items", href: "#/items", kind: "metric", metric: "items" },
  { id: "people", label: "Employees", href: "#/people", kind: "metric", metric: "people" },
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

export function readLayout(): PortletPref[] {
  const defaults = defaultLayout();
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    if (!Array.isArray(parsed)) return defaults;
    const known = new Map(defaults.map((item) => [item.id, item]));
    const next: PortletPref[] = [];
    for (const item of parsed) {
      const base = known.get(item?.id);
      if (!base) continue;
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

  return { layout, editing, setEditing, update };
}
