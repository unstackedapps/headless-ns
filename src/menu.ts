export const menuDefaults = [
  { id: "overview", label: "Overview", group: "Ledger" },
  { id: "customers", label: "Customers", group: "Ledger" },
  { id: "orders", label: "Orders", group: "Ledger" },
  { id: "quotes", label: "Quotes", group: "Ledger" },
  { id: "invoices", label: "Invoices", group: "Ledger" },
  { id: "bills", label: "Bills", group: "Ledger" },
  { id: "items", label: "Items", group: "Ledger" },
  { id: "people", label: "People", group: "Ledger" },
  { id: "searches", label: "Searches", group: "Ledger" },
  { id: "files", label: "Files", group: "Ledger" },
  { id: "records", label: "Records", group: "Studio" },
  { id: "query", label: "Query", group: "Studio" },
  { id: "reports", label: "Reports", group: "Studio" },
  { id: "workbench", label: "Workbench", group: "Studio" },
  { id: "trace", label: "Trace", group: "Studio" },
  { id: "settings", label: "Settings", group: "Studio" },
] as const;

export type ViewId = (typeof menuDefaults)[number]["id"];

// Pages that open from links but have no menu entry.
export type PageId = ViewId | "transaction";

export type MenuItem = { id: ViewId; label: string; group: string; hidden: boolean };

const byId = new Map(menuDefaults.map((item) => [item.id, item]));

export function isViewId(value: string): value is ViewId {
  return byId.has(value as ViewId);
}

export function readMenu(stored: unknown): MenuItem[] {
  const known = new Map(menuDefaults.map((item) => [item.id, { ...item, hidden: false } satisfies MenuItem]));
  const next: MenuItem[] = [];
  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (!item || typeof item !== "object") continue;
      const id = String((item as { id?: string }).id || "");
      if (!isViewId(id) || next.some((row) => row.id === id)) continue;
      const base = known.get(id);
      if (!base) continue;
      next.push({ ...base, hidden: Boolean((item as { hidden?: boolean }).hidden) });
      known.delete(id);
    }
  }
  for (const item of known.values()) next.push(item);
  return next;
}

export function moveMenu(items: MenuItem[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= items.length) return items;
  if (items[index].group !== items[next].group) return items;
  const copy = items.slice();
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row);
  return copy;
}

export function setHidden(items: MenuItem[], id: string, hidden: boolean) {
  return items.map((item) => (item.id === id ? { ...item, hidden } : item));
}
