"use client";

export function Panel({
  title,
  right,
  children,
  className = "",
  pad = true,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-line bg-panel ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-line bg-panel2/70 px-4 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {title}
          </div>
          {right && <div className="flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "buy" | "sell" | "primary" | "ghost" | "danger" | "accent";
  className?: string;
  type?: "button" | "submit";
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-sm",
  };
  const variants: Record<string, string> = {
    buy: "bg-buy/15 text-buy border border-buy/35 hover:bg-buy/25",
    sell: "bg-sell/15 text-sell border border-sell/35 hover:bg-sell/25",
    primary: "bg-acc text-bg font-semibold hover:brightness-110",
    accent: "bg-bg border border-acc/40 text-acc hover:bg-acc/10",
    ghost: "bg-panel2 text-muted border border-line hover:text-ink hover:border-line2",
    danger: "bg-sell/15 text-sell border border-sell/35 hover:bg-sell/25",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  mono,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  mono?: boolean;
}) {
  return (
    <label className="block text-sm">
      {label && (
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
          {label}
        </span>
      )}
      <input
        {...props}
        className={`w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-acc/60 ${mono ? "num" : ""}`}
      />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block text-sm">
      {label && (
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
          {label}
        </span>
      )}
      <select
        {...props}
        className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-ink outline-none focus:border-acc/60"
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({
  children,
  color = "#2dd4bf",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}33` }}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  children,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "up" | "down" | "neutral";
  children?: React.ReactNode;
}) {
  const toneColor =
    tone === "up" ? "text-buy" : tone === "down" ? "text-sell" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-dim">
        {label}
      </div>
      <div className={`num mt-1.5 text-xl font-bold ${toneColor}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
      {children}
    </div>
  );
}

export function Th({
  children,
  right,
}: {
  children?: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right,
  mono = true,
  muted = false,
}: {
  children?: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-[13px] ${right ? "text-right" : "text-left"} ${mono ? "num" : ""} ${muted ? "text-muted" : "text-ink"}`}
    >
      {children}
    </td>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function RankBadge({ rank }: { rank: number }) {
  const colors: Record<number, string> = {
    1: "#f0b90b",
    2: "#c0c9d4",
    3: "#cd7f32",
  };
  if (rank <= 3) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          color: "#080b11",
          backgroundColor: colors[rank],
          boxShadow: `0 0 0 1px ${colors[rank]}55`,
        }}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-panel2 num text-[11px] text-muted">
      {rank}
    </span>
  );
}
