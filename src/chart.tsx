type Point = { label: string; value: number };

export function SeriesChart({ kind, points }: { kind: "bar" | "pie" | "line"; points: Point[] }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  if (kind === "bar") {
    return (
      <div className="bars">
        {points.map((point) => (
          <div className="bar-row" key={point.label}>
            <span>{point.label}</span>
            <span className="bar-track">
              <span style={{ width: `${(point.value / max) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "line") {
    const width = 160;
    const height = 64;
    const coords = points.map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - 4 - (point.value / max) * (height - 8);
      return `${x},${y}`;
    });
    return (
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coords.join(" ")} />
      </svg>
    );
  }
  const total = points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) || 1;
  let cursor = -Math.PI / 2;
  const slices = points.map((point, index) => {
    const sweep = (Math.max(point.value, 0) / total) * Math.PI * 2;
    const start = cursor;
    cursor += sweep;
    const x1 = 16 + 14 * Math.cos(start);
    const y1 = 16 + 14 * Math.sin(start);
    const x2 = 16 + 14 * Math.cos(cursor);
    const y2 = 16 + 14 * Math.sin(cursor);
    const large = sweep > Math.PI ? 1 : 0;
    const path = `M 16 16 L ${x1} ${y1} A 14 14 0 ${large} 1 ${x2} ${y2} Z`;
    return <path key={point.label} d={path} fill="currentColor" opacity={0.35 + (index % 4) * 0.16} />;
  });
  return (
    <svg className="pie" viewBox="0 0 32 32" role="img">
      {slices}
    </svg>
  );
}
