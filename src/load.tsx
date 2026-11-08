export function Lookup({ label }: { label: string }) {
  return (
    <p className="lookup" role="status">
      <span className="lookup-mark" aria-hidden="true" />
      {label}
    </p>
  );
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-row" key={row}>
          {Array.from({ length: cols }, (_, col) => (
            <span className="skeleton" key={col} style={{ width: col === 0 ? "32%" : `${12 + ((row + col) % 4) * 4}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPortlets() {
  return (
    <div className="portlets" role="status" aria-label="Loading totals">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="portlet" data-span="4" key={index}>
          <header>
            <span className="skeleton" style={{ width: "46%" }} />
          </header>
          <div className="body">
            <span className="skeleton lg" />
            <span className="skeleton sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonRecord() {
  return (
    <div role="status" aria-label="Loading record">
      <div className="highlights">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <span className="skeleton sm" />
            <span className="skeleton" style={{ width: "70%", marginTop: 6 }} />
          </div>
        ))}
      </div>
      <div className="record-body">
        <SkeletonTable rows={4} cols={4} />
      </div>
    </div>
  );
}
