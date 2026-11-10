import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Funnel } from "lucide-react";

export type FilterKind = "text" | "choice" | "date" | "number";
export type FilterColumn<T> = { key: string; title: string; kind: FilterKind; value: (row: T) => unknown };
type Value = { text?: string; picked?: string[]; from?: string; to?: string };
export type Filters = Record<string, Value>;

const CHOICE_LIMIT = 12;

function text(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function number(value: unknown) {
  if (typeof value === "number") return value;
  const raw = text(value).replace(/,/g, "");
  return raw !== "" && /^-?\d*\.?\d+$/.test(raw) ? Number(raw) : null;
}

// ISO dates and the M/D/YYYY dates NetSuite returns, as YYYY-MM-DD so they compare as text.
function day(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}

// Picks the control from the values: dates, then numbers, then a short list of repeated values, else text.
export function kindOf(values: unknown[]): FilterKind {
  const filled = values.map(text).filter(Boolean);
  if (!filled.length) return "text";
  if (filled.every((value) => day(value))) return "date";
  if (filled.every((value) => number(value) != null)) return "number";
  const distinct = new Set(filled).size;
  if (distinct <= CHOICE_LIMIT && distinct < filled.length) return "choice";
  return "text";
}

export function activeCount(filters: Filters) {
  return Object.values(filters).filter((value) => value.text?.trim() || value.picked?.length || value.from || value.to).length;
}

export function applyFilters<T>(rows: T[], columns: FilterColumn<T>[], filters: Filters) {
  const live = columns.filter((column) => {
    const value = filters[column.key];
    return value && (value.text?.trim() || value.picked?.length || value.from || value.to);
  });
  if (!live.length) return rows;
  return rows.filter((row) =>
    live.every((column) => {
      const want = filters[column.key];
      const raw = column.value(row);
      if (column.kind === "choice") return want.picked!.includes(text(raw));
      if (column.kind === "date") {
        const at = day(raw);
        return Boolean(at) && (!want.from || at! >= want.from) && (!want.to || at! <= want.to);
      }
      if (column.kind === "number") {
        const at = number(raw);
        if (at == null) return false;
        return (!want.from || at >= Number(want.from)) && (!want.to || at <= Number(want.to));
      }
      return text(raw).toLowerCase().includes(want.text!.trim().toLowerCase());
    }),
  );
}

export function FilterButton<T>({
  columns,
  rows,
  filters,
  onChange,
  total,
  compact = false,
}: {
  compact?: boolean;
  columns: FilterColumn<T>[];
  rows: T[];
  filters: Filters;
  onChange: (next: Filters) => void;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const count = activeCount(filters);
  const choices = useMemo(
    () =>
      Object.fromEntries(
        columns
          .filter((column) => column.kind === "choice")
          .map((column) => [column.key, [...new Set(rows.map((row) => text(column.value(row))).filter(Boolean))].sort()]),
      ),
    [columns, rows],
  );
  const set = (key: string, patch: Value) => onChange({ ...filters, [key]: { ...filters[key], ...patch } });

  return (
    <div className={compact ? "filter-tools compact" : "filter-tools"}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="quiet filter-button" aria-label={count ? `Filters, ${count} on` : "Filters"}>
          <Funnel size={14} strokeWidth={1.75} aria-hidden="true" />
          {!compact && "Filters"}
          {count > 0 && <span className="filter-count" aria-hidden="true">{count}</span>}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content filter-panel" sideOffset={6} align="start" aria-label="Filters">
            <strong>Filter rows</strong>
            {columns.map((column) => {
              const value = filters[column.key] || {};
              return (
                <fieldset key={column.key} className="filter-field">
                  <legend>{column.title}</legend>
                  {column.kind === "choice" ? (
                    choices[column.key].map((option) => (
                      <label key={option} className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(value.picked?.includes(option))}
                          onChange={(event) =>
                            set(column.key, {
                              picked: event.target.checked ? [...(value.picked || []), option] : (value.picked || []).filter((item) => item !== option),
                            })
                          }
                        />
                        {option}
                      </label>
                    ))
                  ) : column.kind === "text" ? (
                    <input aria-label={`${column.title} contains`} placeholder="Contains" value={value.text || ""} onChange={(event) => set(column.key, { text: event.target.value })} />
                  ) : (
                    <div className="filter-range">
                      <input
                        type={column.kind}
                        aria-label={`${column.title} ${column.kind === "date" ? "from" : "minimum"}`}
                        placeholder={column.kind === "date" ? undefined : "Min"}
                        value={value.from || ""}
                        onChange={(event) => set(column.key, { from: event.target.value })}
                      />
                      <span>to</span>
                      <input
                        type={column.kind}
                        aria-label={`${column.title} ${column.kind === "date" ? "to" : "maximum"}`}
                        placeholder={column.kind === "date" ? undefined : "Max"}
                        value={value.to || ""}
                        onChange={(event) => set(column.key, { to: event.target.value })}
                      />
                    </div>
                  )}
                </fieldset>
              );
            })}
            <p className="status">Filters the {total.toLocaleString()} rows shown.</p>
            <div className="filter-foot">
              <button className="linkish" type="button" disabled={!count} onClick={() => onChange({})}>
                Clear all
              </button>
              <Popover.Close className="primary">Done</Popover.Close>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {count > 0 && !compact && (
        <button className="linkish" type="button" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}
