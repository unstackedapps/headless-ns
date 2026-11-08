import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import { Glyph, glyph } from "./icons";

export type RelatedRequest = { kind: "customer" | "transaction" | "item" | "employee"; id: string; title: string };

type GraphNode = { id: string; label: string; detail: string; focus: boolean; kind: string; recordId: string };
type GraphEdge = { id: string; source: string; target: string; label: string };

function openRelated(detail: RelatedRequest) {
  window.dispatchEvent(new CustomEvent<RelatedRequest>("hn-related", { detail }));
}

export function RelatedLink({ kind, id, title }: RelatedRequest) {
  return (
    <button className="linkish" type="button" onClick={() => openRelated({ kind, id, title })}>
      <Glyph icon={glyph.related} size={14} />
      Related
    </button>
  );
}

function place(records: GraphNode[], links: GraphEdge[]) {
  const rank = new Map<string, number>();
  for (const record of records) if (record.focus) rank.set(record.id, 0);
  if (!rank.size && records[0]) rank.set(records[0].id, 0);
  for (let pass = 0; pass < records.length; pass += 1) {
    for (const link of links) {
      const from = rank.get(link.source);
      if (from == null) continue;
      const next = from + 1;
      if ((rank.get(link.target) ?? -1) < next) rank.set(link.target, next);
    }
  }
  const columns = new Map<number, GraphNode[]>();
  for (const record of records) {
    const column = rank.get(record.id) ?? 0;
    const list = columns.get(column) || [];
    list.push(record);
    columns.set(column, list);
  }
  const nodes: Node[] = records.map((record) => {
    const column = rank.get(record.id) ?? 0;
    const list = columns.get(column) || [];
    return {
      id: record.id,
      position: { x: column * 240, y: list.indexOf(record) * 88 },
      data: { label: record.detail ? `${record.label}\n${record.detail}` : record.label },
      style: {
        width: 200,
        whiteSpace: "pre-line",
        fontSize: 12,
        lineHeight: 1.35,
        padding: "8px 10px",
        background: "var(--panel)",
        color: "var(--ink)",
        border: record.focus ? "1px solid var(--accent)" : "1px solid var(--line)",
        borderRadius: "var(--radius-control)",
      },
    };
  });
  const edges: Edge[] = links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    label: link.label || undefined,
  }));
  return { nodes, edges };
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
    fetch(`/api/related?kind=${request.kind}&id=${encodeURIComponent(request.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The related records did not load.");
        setGraph(body);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [request]);

  const flow = useMemo(() => (graph ? place(graph.nodes, graph.edges) : null), [graph]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequest(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  if (!request) return null;

  return (
    <div className="backdrop" role="presentation" onClick={() => setRequest(null)}>
      <aside className="drawer graph-drawer" role="dialog" aria-label="Related records" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-top">
          <div>
            <div className="kicker">Related</div>
            <h2>{request.title}</h2>
          </div>
          <button className="quiet" type="button" onClick={() => setRequest(null)}>
            <Glyph icon={glyph.close} size={14} />
            Close
          </button>
        </header>
        <p className="status">These records link to this one. Drag the canvas to look around.</p>
        {error && <p className="error">{error}</p>}
        {!flow && !error && <p className="status">Looking up the links.</p>}
        {flow && (
          <div className="flow-wrap">
            <ReactFlow
              key={`${request.kind}:${request.id}`}
              nodes={flow.nodes}
              edges={flow.edges}
              fitView
              nodesDraggable={false}
              onNodeClick={(_, node) => {
                const record = graph?.nodes.find((item) => item.id === node.id);
                if (!record || record.kind !== "transaction" || record.recordId === request.id) return;
                setGraph(null);
                setError(null);
                setRequest({ kind: "transaction", id: record.recordId, title: record.label });
              }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}
      </aside>
    </div>
  );
}
