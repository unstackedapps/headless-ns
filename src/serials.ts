// A serial or lot number on one line. Fulfillments pick numbers in stock (`id`); receipts type new ones (`number`).
export type Picked = { id?: string; number?: string; quantity: number };

// Serial items ship one number per unit. With one unit, picking a number replaces the last pick.
// With more, picking stops once the count matches the quantity.
export function pickSerial(value: Picked[], id: string, on: boolean, quantity: number): Picked[] {
  if (!on) return value.filter((entry) => entry.id !== id);
  if (value.some((entry) => entry.id === id)) return value;
  if (quantity === 1) return [{ id, quantity: 1 }];
  if (value.length >= quantity) return value;
  return [...value, { id, quantity: 1 }];
}

export function serialFull(value: Picked[], quantity: number) {
  return value.length >= quantity;
}

export function pickedTotal(value: Picked[]) {
  return value.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
}

// Receiving serial items: one box per unit, each worth 1.
export function serialRows(value: Picked[], quantity: number): Picked[] {
  const count = Math.min(Math.max(Math.floor(quantity) || 0, 0), 200);
  return Array.from({ length: count }, (_, at) => ({ number: value[at]?.number ?? "", quantity: 1 }));
}

export function editRow(value: Picked[], index: number, change: Partial<Picked>): Picked[] {
  return value.map((entry, at) => (at === index ? { ...entry, ...change } : entry));
}

// What is still missing before a tracked line can be saved, or "" when it is ready.
export function numbersProblem(value: Picked[], quantity: number, tracking: "serial" | "lot", line: number, receiving: boolean) {
  const kind = `${tracking} number${quantity === 1 ? "" : "s"}`;
  const named = value.filter((entry) => (receiving ? entry.number?.trim() : entry.id));
  if (named.length < value.length || !value.length) return `Line ${line} needs ${receiving ? "every" : "its"} ${kind}${receiving ? " filled in" : " picked"}.`;
  if (receiving && new Set(named.map((entry) => entry.number?.trim())).size < named.length) return `Line ${line} has the same ${tracking} number twice.`;
  const total = pickedTotal(value);
  if (Math.abs(total - quantity) > 1e-9) return `Line ${line} ${receiving ? "receives" : "ships"} ${quantity}, but its ${tracking} quantities add up to ${total}.`;
  return "";
}
