// What an empty cell shows, everywhere.
export const BLANK = "—";

export function orBlank(value: unknown) {
  return value == null || value === "" ? BLANK : String(value);
}

export function amount(value: number | null | undefined, currency?: string) {
  if (value == null || Number.isNaN(value)) return BLANK;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  const sign = value < 0 ? "-" : "";
  return currency ? `${sign}${formatted} ${currency}` : `${sign}${formatted}`;
}

export function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return BLANK;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!iso) return value;
  return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
}

export function clock(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
