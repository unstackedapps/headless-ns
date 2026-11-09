import { useEffect, useMemo, useState } from "react";
import { Glyph, glyph } from "./icons";
import { api } from "./api";
import { Drawer } from "./drawer";

export type RelatedRequest = { kind: "customer" | "transaction" | "item" | "employee"; id: string; title: string };

type GraphNode = { id: string; label: string; detail: string; focus: boolean; kind: string; recordId: string; href?: string };
type GraphEdge = { id: string; source: string; target: string; label: string };
type TreeNode = GraphNode & { children: TreeNode[] };

function openRelated(detail: RelatedRequest) {
  window.dispatchEvent(new CustomEvent<RelatedRequest>("hn-related", { detail }));
}

export function RelatedLink({ kind, id, title }: RelatedRequest) {
  return (
    <button className="linkish" type="button" aria-label={`Related records for ${title}`} onClick={() => openRelated({ kind, id, title })}>
      <Glyph icon={glyph.related} size={14} />
      Related
    </button>
  );
}

function treeFrom(records: GraphNode[], links: GraphEdge[]) {
  const focus = records.find((record) => record.focus) || records[0];
  if (!focus) return null;
  const byId = new Map(records.map((record) => [record.id, record]));
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, from: string, to: string) => {
    const list = map.get(from) || [];
    if (!list.includes(to)) list.push(to);
    map.set(from, list);
  };
  for (const link of links) {
    push(next, link.source, link.target);
    push(prev, link.target, link.source);
  }
  const seen = new Set<string>([focus.id]);
  function build(id: string, depth: number): TreeNode | null {
    const record = byId.get(id);
    if (!record) return null;
    const children: TreeNode[] = [];
    if (depth < 6) {
      for (const other of [...(next.get(id) || []), ...(prev.get(id) || [])]) {
        if (seen.has(other)) continue;
        seen.add(other);
        const child = build(other, depth + 1);
        if (child) children.push(child);
      }
    }
    return { ...record, children };
  }
  return build(focus.id, 0);
}

function Branch({ node, depth, onOpen }: { node: TreeNode; depth: number; onOpen: (node: TreeNode) => void }) {
  return (
    <li>
      <div className={node.focus ? "rel-row is-focus" : "rel-row"} style={{ paddingLeft: 12 + depth * 16 }}>
        <Glyph icon={node.children.length ? glyph.folder : glyph.file} size={14} />
        <span>{node.label}</span>
        {node.detail && <em>{node.detail}</em>}
        <span className="rel-actions">
          {!node.focus && node.kind === "transaction" && (
            <button className="linkish" type="button" onClick={() => onOpen(node)}>
              Deeper
            </button>
          )}
          {node.href && (
            <a href={node.href} target="_blank" rel="noreferrer">
              <Glyph icon={glyph.external} size={14} />
              Open
            </a>
          )}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Branch key={child.id} node={child} depth={depth + 1} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RelatedHost() {
  const [request, setRequest] = useState<RelatedRequest | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<RelatedRequest>).detail;
      if (!detail?.id) return;
      setRequest(detail);
      setGraph(null);
      setError(null);
    };
    window.addEventListener("hn-related", onOpen);
    return () => window.removeEventListener("hn-related", onOpen);
  }, []);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/related?kind=${request.kind}&id=${encodeURIComponent(request.id)}`, { signal: controller.signal })
      .then(setGraph)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [request]);

  const tree = useMemo(() => (graph ? treeFrom(graph.nodes, graph.edges) : null), [graph]);

  if (!request) return null;

  function openNode(node: TreeNode) {
    if (node.kind !== "transaction" || node.recordId === request?.id) return;
    setGraph(null);
    setError(null);
    setRequest({ kind: "transaction", id: node.recordId, title: node.label });
  }

  return (
    <Drawer kicker="Related" title={request.title} narrow onClose={() => setRequest(null)} error={error}>
      <div className="record-body">
        <p className="status">Click Deeper to see that record's links, or Open to see it in NetSuite.</p>
        {!tree && !error && <p className="status">Looking up the links.</p>}
        {tree && tree.children.length === 0 && <p className="status">Nothing else is linked to this record.</p>}
        {tree && tree.children.length > 0 && (
          <ul className="rel-tree">
            <Branch node={tree} depth={0} onOpen={openNode} />
          </ul>
        )}
      </div>
    </Drawer>
  );
}
