import { useState } from "react";
import { count } from "./format";
import { ListFrame, type ListPayload, RecordActions, explain, listStatus, useDebounced, useLive } from "./lists";

type Item = {
  id: string;
  name: string;
  displayName: string;
  onHand: number | null;
  available: number | null;
  href: string;
};

export function ItemsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Item>>(`/api/items${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title="Items"
      viewName="Inventory parts"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder="Item name"
      scope={q ? `/api/items?q=${encodeURIComponent(q)}` : "/api/items"}
    >
      {live.data?.note && <p className="status">{explain(live.data.note)}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Display name</th>
              <th className="num">On hand</th>
              <th className="num">Available</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.displayName || "—"}</td>
                <td className="num">{row.onHand == null ? "—" : count(row.onHand)}</td>
                <td className="num">{row.available == null ? "—" : count(row.available)}</td>
                <td>
                  <RecordActions kind="item" id={row.id} title={row.name} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  No inventory items matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}
