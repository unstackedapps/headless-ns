import { useState } from "react";
import { dateLabel, orBlank } from "./format";
import { DataTable, EmailText } from "./table";
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
      <DataTable
        label="People"
        rows={live.data?.rows}
        rowKey={(row) => row.id}
        empty="No employees matched."
        columns={[
          { key: "name", label: "Name", cell: (row) => row.name },
          { key: "title", label: "Title", cell: (row) => orBlank(row.title) },
          { key: "subsidiary", label: "Subsidiary", cell: (row) => orBlank(row.subsidiary) },
          { key: "email", label: "Email", cell: (row) => <EmailText value={row.email} /> },
          { key: "hired", label: "Hired", nowrap: true, cell: (row) => dateLabel(row.hireDate) },
          {
            key: "rep",
            label: "Sales rep",
            cell: (row) => <StatusPill value={row.salesRep === "Yes" || row.salesRep === "T" ? "Yes" : row.salesRep || "No"} />,
          },
          { key: "netsuite", label: "NetSuite", cell: (row) => <RecordActions kind="employee" id={row.id} title={row.name} href={row.href} /> },
        ]}
      />
    </ListFrame>
  );
}
