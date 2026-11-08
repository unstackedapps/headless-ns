export function LoadingPage({ cover = false }: { cover?: boolean }) {
  return (
    <div className={cover ? "hns-screen is-cover" : "hns-screen"} role="status" aria-label="Loading">
      <div className="hns-mark">
      <svg className="hns-loader" viewBox="0 0 32 32" width="96" height="96" aria-hidden="true">
        <rect width="32" height="32" rx="3" fill="#1E4B80" />
        <g fill="#fff">
          <rect className="hns-hdr" x="7" y="4.5" width="18" height="3" />
          <g className="hns-r1">
            <rect x="7" y="13" width="11" height="3" />
            <rect x="20" y="13" width="5" height="3" />
          </g>
          <g className="hns-r2">
            <rect x="7" y="18.5" width="11" height="3" />
            <rect x="20" y="18.5" width="5" height="3" />
          </g>
          <rect x="7" y="24" width="11" height="3" />
          <rect x="20" y="24" width="5" height="3" />
        </g>
      </svg>
      {cover && <p className="hns-name">headless-ns</p>}
      </div>
    </div>
  );
}

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
