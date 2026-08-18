export function AreaChart({
  data,
  height = 160,
  stroke = "#2dd4bf",
  id = "ac",
}: {
  data: number[];
  height?: number;
  stroke?: string;
  id?: string;
}) {
  const w = 600;
  if (data.length < 2) {
    return <div style={{ height }} className="animate-pulse rounded-md bg-panel2" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - 4 - ((v - min) / range) * (height - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = data[data.length - 1] >= data[0];
  const color = up ? "#2ecc71" : "#f0514c";
  const gid = `${id}-${color.replace(/[^a-z0-9]/gi, "")}`;
  const last = pts[pts.length - 1].split(",");
  const [lx, ly] = last;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={w}
          y1={height * f}
          y2={height * f}
          stroke="#1c2735"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
      ))}
      <polygon
        points={`0,${height} ${pts.join(" ")} ${w},${height}`}
        fill={`url(#${gid})`}
        stroke="none"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r="3.5" fill={color} stroke="#080b11" strokeWidth="1.5" />
    </svg>
  );
}
