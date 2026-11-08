import { useState } from "react";
import { amount, dateLabel } from "./format";
import { flowLink } from "./transaction";
import { ListFrame, type ListPayload, RecordActions, listStatus, useDebounced, useLive } from "./lists";

type Bill = {
  id: string;
  number: string;
  date: string;
  due: string;
  name: string;
  currency: string;
  amount: number | null;
  unpaid: number | null;
  href: string;
};

export function BillsPage({ title, path, party, recordType }: { title: string; path: string; party: string; recordType: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const live = useLive<ListPayload<Bill>>(`${path}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <ListFrame
      title={title}
      viewName={`Open ${title.toLowerCase()}`}
      status={listStatus(live)}
      error={live.error}
      loading={live.loading}
      ready={Boolean(live.data)}
      search={search}
      onSearch={setSearch}
      placeholder={`Number or ${party.toLowerCase()}`}
      scope={q ? `${path}?q=${encodeURIComponent(q)}` : path}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Due</th>
              <th>{party}</th>
              <th className="num">Amount</th>
              <th className="num">Open</th>
              <th>NetSuite</th>
            </tr>
          </thead>
          <tbody>
            {live.data?.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <a href={flowLink(recordType, row.id)}>{row.number}</a>
                </td>
                <td>{dateLabel(row.date)}</td>
                <td>{dateLabel(row.due)}</td>
                <td>{row.name}</td>
                <td className="num">{amount(row.amount, row.currency)}</td>
                <td className="num">{amount(row.unpaid, row.currency)}</td>
                <td>
                  <RecordActions kind="transaction" id={row.id} title={row.number} href={row.href} recordType={recordType} />
                </td>
              </tr>
            ))}
            {live.data && live.data.rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  No open {title.toLowerCase()} matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ListFrame>
  );
}
