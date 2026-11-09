// Adds a column to the editor's SELECT. A query on another table, or no query, starts over.
export function addColumn(sql: string, table: string, column: string) {
  const match = /^\s*select\s+([\s\S]*?)\s+from\s+([A-Za-z0-9_]+)\b([\s\S]*)$/i.exec(sql);
  if (!match || match[2].toLowerCase() !== table.toLowerCase()) return `SELECT ${column}\nFROM ${table}`;
  const list = match[1].trim();
  const names = list.split(",").map((part) => part.trim().toLowerCase());
  if (names.includes(column.toLowerCase())) return sql;
  const next = list === "*" ? column : `${list}, ${column}`;
  return `SELECT ${next}\nFROM ${match[2]}${match[3]}`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

// Tables people query most, listed first. The rest sit behind the filter.
export const commonTables = ["transaction", "transactionline", "customer", "vendor", "item", "employee", "location", "inventorybalance"];

export function isMissingLabel(title: string) {
  return /^\[Missing Label/i.test(title);
}

export const sampleQueries = [
  {
    name: "Open sales orders",
    sql: "SELECT t.tranid, t.trandate, BUILTIN.DF(t.entity) AS customer, BUILTIN.DF(t.status) AS status, t.foreigntotal AS amount\nFROM transaction t\nWHERE t.type = 'SalesOrd' AND t.status IN ('A', 'B', 'D', 'E', 'F')\nORDER BY t.trandate DESC",
  },
  {
    name: "Overdue invoices",
    sql: "SELECT t.tranid, t.duedate, BUILTIN.DF(t.entity) AS customer, t.foreignamountremaining AS open_amount\nFROM transaction t\nWHERE t.type = 'CustInvc' AND t.status = 'A' AND t.duedate < CURRENT_DATE\nORDER BY t.duedate",
  },
  {
    name: "Stock by location",
    sql: "SELECT BUILTIN.DF(b.item) AS item, BUILTIN.DF(b.location) AS location, SUM(b.quantityonhand) AS on_hand, SUM(b.quantityavailable) AS available\nFROM inventorybalance b\nGROUP BY BUILTIN.DF(b.item), BUILTIN.DF(b.location)\nORDER BY item",
  },
  {
    name: "Top customers this month",
    sql: "SELECT BUILTIN.DF(t.entity) AS customer, COUNT(t.id) AS orders, SUM(t.foreigntotal) AS total\nFROM transaction t\nWHERE t.type = 'SalesOrd' AND t.trandate >= TRUNC(CURRENT_DATE, 'MM')\nGROUP BY BUILTIN.DF(t.entity)\nORDER BY total DESC",
  },
];
