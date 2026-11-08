import { field } from "./netsuite.mjs";

function docId(row, name) {
  const value = String(field(row, name) ?? "");
  return /^-?\d+$/.test(value) ? value : "";
}

export function absorbLinks(frontier, rows) {
  const front = new Set(frontier.map(String));
  const edges = [];
  const seenEdge = new Set();
  const next = [];
  const added = new Set();
  for (const row of rows || []) {
    const prev = docId(row, "previousdoc");
    const dest = docId(row, "nextdoc");
    if (!prev || !dest || prev === dest) continue;
    if (!front.has(prev) && !front.has(dest)) continue;
    const id = `${prev}>${dest}`;
    if (!seenEdge.has(id)) {
      seenEdge.add(id);
      edges.push({ id, source: `transaction:${prev}`, target: `transaction:${dest}`, label: "" });
    }
    for (const doc of [prev, dest]) {
      if (front.has(doc) || added.has(doc)) continue;
      added.add(doc);
      next.push(doc);
    }
  }
  return { frontier: next, edges };
}

export async function walkRelated(start, lookup, steps = 6) {
  const seen = new Set([String(start)]);
  const edges = [];
  const edgeIds = new Set();
  let frontier = [String(start)];
  for (let step = 0; step < steps && frontier.length; step += 1) {
    const absorbed = absorbLinks(frontier, await lookup(frontier));
    for (const edge of absorbed.edges) {
      if (edgeIds.has(edge.id)) continue;
      edgeIds.add(edge.id);
      edges.push(edge);
    }
    const added = [];
    for (const id of absorbed.frontier) {
      if (seen.has(id)) continue;
      // shortcut: a busy transaction stops at 40 linked records
      if (seen.size >= 40) break;
      seen.add(id);
      added.push(id);
    }
    frontier = added;
  }
  return { ids: [...seen], edges };
}
