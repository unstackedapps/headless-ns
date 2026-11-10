// ns_runSavedSearch returns internal ids for list and record columns, such as Name 479 or Currency 1,
// and status codes such as pendingFulfillment. This swaps them for the names NetSuite shows.

// Column label -> SuiteQL that returns { id, name } for a list of ids. Periods go through transaction,
// because roles that can run searches often cannot read accountingperiod.
const LOOKUPS = [
  [/^(name|customer|vendor|entity|company|employee|sales ?rep|created by|contact|partner|payee)$/i, (ids) => `SELECT id, entitytitle AS name FROM entity WHERE id IN (${ids})`],
  [/^item$/i, (ids) => `SELECT id, itemid AS name FROM item WHERE id IN (${ids})`],
  [/period$/i, (ids) => `SELECT DISTINCT postingperiod AS id, BUILTIN.DF(postingperiod) AS name FROM transaction WHERE postingperiod IN (${ids})`],
  [/^currency$/i, (ids) => `SELECT id, name FROM currency WHERE id IN (${ids})`],
  [/^location$/i, (ids) => `SELECT id, name FROM location WHERE id IN (${ids})`],
  [/^subsidiary$/i, (ids) => `SELECT id, name FROM subsidiary WHERE id IN (${ids})`],
  [/^department$/i, (ids) => `SELECT id, name FROM department WHERE id IN (${ids})`],
  [/^class$/i, (ids) => `SELECT id, name FROM classification WHERE id IN (${ids})`],
  [/^terms?$/i, (ids) => `SELECT id, name FROM term WHERE id IN (${ids})`],
];

const ID = /^\d{1,12}$/;

// pendingFulfillment -> Pending fulfillment. Leaves text that is not a camelCase code alone.
export function statusLabel(value) {
  const text = String(value ?? "");
  if (!/^[a-z]+(?:[A-Z][a-z]*)+$/.test(text)) return text;
  const words = text.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Which columns hold ids to look up: a known label, and every filled value an id.
export function lookupPlan(columns, rows) {
  return columns.flatMap((column) => {
    const match = LOOKUPS.find(([pattern]) => pattern.test(column.trim()));
    if (!match) return [];
    const values = rows.map((row) => String(row[column] ?? "").trim()).filter(Boolean);
    if (!values.length || !values.every((value) => ID.test(value))) return [];
    const ids = [...new Set(values)];
    return [{ column, sql: match[1](ids.join(", ")) }];
  });
}

// run(sql) returns rows of { id, name }. A lookup that fails leaves that column as ids.
export async function withNames(columns, rows, run) {
  const plan = lookupPlan(columns, rows);
  const names = {};
  await Promise.all(
    plan.map(async ({ column, sql }) => {
      try {
        const found = await run(sql);
        names[column] = new Map(found.map((row) => [String(row.id), String(row.name ?? "")]));
      } catch {
        names[column] = null;
      }
    }),
  );
  const statusColumns = columns.filter((column) => /status/i.test(column));
  return rows.map((row) => {
    const next = { ...row };
    for (const column of Object.keys(names)) {
      const name = names[column]?.get(String(row[column] ?? "").trim());
      if (name) next[column] = name;
    }
    for (const column of statusColumns) if (row[column] != null) next[column] = statusLabel(row[column]);
    return next;
  });
}
