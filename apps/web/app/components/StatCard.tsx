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
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
