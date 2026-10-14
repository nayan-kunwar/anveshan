import type { ReactNode } from "react";

export default function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}): ReactNode {
  const numeric = /^\d+$/.test(value);
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={numeric ? "value" : "value value-text"}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
