export type Picked = { id: string; quantity: number };

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
