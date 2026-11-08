import { useState } from "react";
import { count } from "./format";
import { ListFrame, type ListPayload, Pager, RecordActions, explain, listStatus, useDebounced, useLive } from "./lists";

type Item = {
  id: string;
  name: string;
  displayName: string;
  type: string;
  recordType: string;
  onHand: number | null;
  available: number | null;
  href: string;
};
type Payload = ListPayload<Item> & { types: { id: string; label: string }[] };

export function ItemsPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(0);
  const q = useDebounced(search, 300);
  const params = new URLSearchParams({ type, page: String(page) });
  if (q) params.set("q", q);
  const path = `/api/items?${params}`;
  const live = useLive<Payload>(path);
  return (
    <ListFrame
      title="Items"
      viewName={type === "all" ? "All active items" : "Active items"}
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        setPage(0);
      }}
      placeholder="Item name"
      scope={path}
      bar={
        <label className="list-filter">
          Type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All</option>
            {(live.data?.types || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {live.data?.note && <p className="status">{explain(live.data.note)}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Display name</th>
              <th>Type</th>
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
                <td>{row.type || "—"}</td>
                <td className="num">{row.onHand == null ? "—" : count(row.onHand)}</td>
                <td className="num">{row.available == null ? "—" : count(row.available)}</td>
                <td>
                  <RecordActions kind="item" id={row.id} title={row.name} href={row.href} recordType={row.recordType || undefined} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  No items matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {live.data && <Pager page={page} hasMore={live.data.hasMore} onPage={setPage} />}
    </ListFrame>
  );
}
