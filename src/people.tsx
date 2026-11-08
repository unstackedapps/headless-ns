import { useState } from "react";
import { dateLabel } from "./format";
import { ListFrame, type ListPayload, RecordActions, StatusPill, listStatus, useDebounced, useLive } from "./lists";

type Person = {
  id: string;
  name: string;
  title: string;
  email: string;
  hireDate: string;
  subsidiary: string;
  salesRep: string;
  href: string;
};

export function PeoplePage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Person>>(`/api/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title="People"
      viewName="Active employees"
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder="Name, title, or email"
      scope={q ? `/api/employees?q=${encodeURIComponent(q)}` : "/api/employees"}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Subsidiary</th>
              <th>Email</th>
              <th>Hired</th>
              <th>Sales rep</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.title || "—"}</td>
                <td>{row.subsidiary || "—"}</td>
                <td>{row.email || "—"}</td>
                <td>{dateLabel(row.hireDate)}</td>
                <td>
                  <StatusPill value={row.salesRep === "Yes" || row.salesRep === "T" ? "Yes" : row.salesRep || "No"} />
                </td>
                <td>
                  <RecordActions kind="employee" id={row.id} title={row.name} href={row.href} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  No employees matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}
