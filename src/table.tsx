import type { ReactNode } from "react";
import { SkeletonTable } from "./load";
import { orBlank } from "./format";

export type Column<T> = {
  key: string;
  label: ReactNode;
  num?: boolean;
  // Keeps a short value, such as a date or a number, on one line.
  nowrap?: boolean;
  className?: string;
  sort?: "ascending" | "descending" | "none";
  cell: (row: T, index: number) => ReactNode;
};

// The one table: a skeleton while the first rows load, an error line, and one empty row style.
// rows is null until the first load finishes.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  empty = "No rows.",
  head,
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
  className?: string;
  wrap?: "plain" | "loose";
  label?: string;
  skeletonRows?: number;
}) {
  const wrapClass = wrap ? `table-wrap ${wrap}` : "table-wrap";
  return (
    <>
      {error && <p className="error">{error}</p>}
      {!rows ? (
        loading ? <SkeletonTable rows={skeletonRows} cols={columns.length} /> : null
      ) : (
        <div className={wrapClass}>
          <table className={className} aria-label={label}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={cellClass(column)} aria-sort={column.sort}>
                    {column.label}
                  </th>
                ))}
              </tr>
              {head}
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={rowKey(row, index)}>
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.cell(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={columns.length}>
                    {empty}
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
