// Overview is pinned at the top and Settings at the bottom. The rest sit in groups that fold.
export const menuGroups = [
  { id: "Sales", open: true },
  { id: "Purchasing", open: true },
  { id: "Company", open: false },
  { id: "Data", open: false },
  { id: "Tools", open: false },
] as const;

export const menuDefaults = [
  { id: "overview", label: "Overview", group: "Top" },
  { id: "customers", label: "Customers", group: "Sales" },
  { id: "quotes", label: "Quotes", group: "Sales" },
  { id: "orders", label: "Orders", group: "Sales" },
  { id: "fulfillments", label: "Fulfillments", group: "Sales" },
  { id: "invoices", label: "Invoices", group: "Sales" },
  { id: "payments", label: "Payments", group: "Sales" },
  { id: "returns", label: "Returns", group: "Sales" },
  { id: "vendors", label: "Vendors", group: "Purchasing" },
  { id: "purchaseorders", label: "Purchase orders", group: "Purchasing" },
  { id: "receipts", label: "Receipts", group: "Purchasing" },
  { id: "bills", label: "Bills", group: "Purchasing" },
  { id: "billpayments", label: "Bill payments", group: "Purchasing" },
  { id: "items", label: "Items", group: "Company" },
  { id: "people", label: "People", group: "Company" },
  { id: "files", label: "Files", group: "Company" },
  { id: "searches", label: "Searches", group: "Data" },
  { id: "reports", label: "Reports", group: "Data" },
  { id: "query", label: "Query", group: "Data" },
  { id: "records", label: "Records", group: "Data" },
  { id: "workbench", label: "Workbench", group: "Tools" },
  { id: "trace", label: "Trace", group: "Tools" },
  { id: "settings", label: "Settings", group: "Bottom" },
] as const;

export type ViewId = (typeof menuDefaults)[number]["id"];

// Pages that open from links but have no menu entry.
export type PageId = ViewId | "transaction";

export type MenuItem = { id: ViewId; label: string; group: string; hidden: boolean };

const byId = new Map(menuDefaults.map((item) => [item.id, item]));
const groupOrder = ["Top", ...menuGroups.map((group) => group.id), "Bottom"];

export function isViewId(value: string): value is ViewId {
  return byId.has(value as ViewId);
}

// The menu group a page belongs to, used as the kicker above its title.
export function groupOf(id: string) {
  const group = byId.get(id as ViewId)?.group;
  return group === "Top" || group === "Bottom" || !group ? "" : group;
}

// Reads the saved menu. The group always comes from menuDefaults, never from storage.
// The old format (a bare array, from before the groups) keeps only what was hidden.
export function readMenu(stored: unknown): MenuItem[] {
  const saved = Array.isArray(stored) ? stored : (stored as { v?: number; items?: unknown })?.v === 2 ? (stored as { items: unknown }).items : null;
  const keepOrder = !Array.isArray(stored);
  const hidden = new Map<string, boolean>();
  const order: string[] = [];
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (!item || typeof item !== "object") continue;
      const id = String((item as { id?: string }).id || "");
      if (!isViewId(id) || hidden.has(id)) continue;
      hidden.set(id, Boolean((item as { hidden?: boolean }).hidden));
      if (keepOrder) order.push(id);
    }
  }
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + menuDefaults.findIndex((item) => item.id === id));
  return menuDefaults
    .map((item) => ({ ...item, hidden: hidden.get(item.id) ?? false }) satisfies MenuItem)
    .sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || rank(a.id) - rank(b.id));
}

export function saveMenu(items: MenuItem[]) {
  return { v: 2, items: items.map(({ id, hidden }) => ({ id, hidden })) };
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

// Which groups are open. A stored value wins over the default.
export function readGroups(stored: unknown): Record<string, boolean> {
  const saved = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(menuGroups.map((group) => [group.id, typeof saved[group.id] === "boolean" ? (saved[group.id] as boolean) : group.open]));
}
