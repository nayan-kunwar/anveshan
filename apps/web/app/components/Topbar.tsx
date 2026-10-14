import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";

export default function Topbar({
  title,
  email,
  subtitle,
}: {
  title: string;
  email: string;
  subtitle?: string;
}): ReactNode {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="topbar-sub">{subtitle}</p> : null}
      </div>
      <div className="topbar-right">
        <ThemeToggle />
        <span className="avatar" title={email}>
          {email.charAt(0)}
        </span>
      </div>
    </div>
  );
}
