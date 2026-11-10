import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SkeletonTable } from "./load";
import { orBlank } from "./format";
import { applyFilters, FilterButton, kindOf, type FilterColumn, type FilterKind, type Filters } from "./filters";

export type Column<T> = {
  key: string;
  label: ReactNode;
  num?: boolean;
  // Keeps a short value, such as a date or a number, on one line.
  nowrap?: boolean;
  className?: string;
  sort?: "ascending" | "descending" | "none";
  cell: (row: T, index: number) => ReactNode;
  // The raw value the Filters panel reads. Defaults to row[key] when the row has that field.
  value?: (row: T) => unknown;
  // The panel picks a control from the values; set this to choose one, or false for no filter.
  filter?: FilterKind | false;
  // The column's name in the Filters panel, when label is not plain text.
  title?: string;
};

// A page marks the spot in its own toolbar, next to its search box, where the table's Filters button goes.
// Drawers reset it to null, so a table in a drawer never reaches into the page behind it.
export const TableSlot = createContext<HTMLElement | null>(null);

export function useTableSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return { slot, target: <span className="table-slot" ref={setSlot} /> };
}

// The one table: a skeleton while the first rows load, an error line, one empty row style,
// and a Filters button that filters the rows it was given. rows is null until the first load finishes.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  empty = "No rows.",
  head,
  tools,
  noFilters = false,
  className,
  wrap,
  label,
  skeletonRows = 8,
}: {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: string | null;
  empty?: ReactNode;
  head?: ReactNode;
  // Controls that share the row with the Filters button, such as a search box.
  tools?: ReactNode;
  // Turns the Filters button off, for a grid being edited.
  noFilters?: boolean;
  className?: string;
  wrap?: "plain" | "loose";
  label?: string;
  skeletonRows?: number;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const filterable = useMemo(() => (noFilters ? [] : filterColumns(columns, rows || [])), [noFilters, columns, rows]);
  const live = useMemo(() => Object.fromEntries(filterable.filter((column) => filters[column.key]).map((column) => [column.key, filters[column.key]])), [filterable, filters]);
  // Each row keeps its index in rows, so cell and rowKey callbacks that edit by index stay correct.
  const shown = useMemo(() => {
    if (!rows) return rows;
    const kept = new Set(applyFilters(rows, filterable, live));
    return rows.flatMap((row, index) => (kept.has(row) ? [{ row, index }] : []));
  }, [rows, filterable, live]);
  const slot = useContext(TableSlot);
  const wrapClass = wrap ? `table-wrap ${wrap}` : "table-wrap";
  const canFilter = Boolean(rows && rows.length > 0 && filterable.length > 0);
  const button = (compact: boolean) => (
    <FilterButton columns={filterable} rows={rows || []} filters={live} onChange={setFilters} total={rows?.length || 0} compact={compact} />
  );
  // The button goes next to the search box: in tools, in the page's toolbar slot, or else in the header row.
  const inHeader = canFilter && !tools && !slot;
  return (
    <>
      {error && <p className="error">{error}</p>}
      {tools && (
        <div className="table-tools">
          {tools}
          {canFilter && button(false)}
        </div>
      )}
      {!tools && slot && canFilter && createPortal(button(false), slot)}
      {!shown ? (
        loading ? <SkeletonTable rows={skeletonRows} cols={columns.length} /> : null
      ) : (
        <div className={wrapClass}>
          <table className={className} aria-label={label}>
            <thead>
              <tr>
                {columns.map((column, at) => (
                  <th key={column.key} className={cellClass(column)} aria-sort={column.sort}>
                    {column.label}
                    {inHeader && at === columns.length - 1 && button(true)}
                  </th>
                ))}
              </tr>
              {head}
            </thead>
            <tbody>
              {shown.map(({ row, index }) => (
                <tr key={rowKey(row, index)}>
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.cell(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td className="empty" colSpan={columns.length}>
                    {rows!.length > 0 ? "No rows match the filters." : empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Columns the panel can filter: an explicit value, or a field of the same name on the rows.
function filterColumns<T>(columns: Column<T>[], rows: T[]): FilterColumn<T>[] {
  const sample = rows.find((row) => row && typeof row === "object") as Record<string, unknown> | undefined;
  return columns.flatMap((column) => {
    if (column.filter === false) return [];
    const value = column.value || (sample && column.key in sample ? (row: T) => (row as Record<string, unknown>)[column.key] : null);
    if (!value) return [];
    const values = rows.map(value);
    if (values.every((item) => item == null || String(item).trim() === "")) return [];
    const title = column.title || (typeof column.label === "string" ? column.label : column.key);
    return [{ key: column.key, title, kind: column.filter || kindOf(values), value }];
  });
}

// An email that wraps after its @ when the column is narrow, instead of mid-word.
export function EmailText({ value }: { value: string }) {
  const at = value.indexOf("@");
  if (at < 0) return <>{orBlank(value)}</>;
  return (
    <>
      {value.slice(0, at + 1)}
      <wbr />
      {value.slice(at + 1)}
    </>
  );
}

function cellClass(column: { num?: boolean; nowrap?: boolean; className?: string }) {
  return [column.num ? "num" : "", column.nowrap ? "nowrap" : "", column.className || ""].filter(Boolean).join(" ") || undefined;
}
