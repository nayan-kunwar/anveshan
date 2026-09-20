import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";

export default function Topbar({
  title,
  email,
}: {
  title: string;
  email: string;
}): ReactNode {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="topbar-right">
        <ThemeToggle />
        <span className="avatar" title={email}>
          {email.charAt(0)}
        </span>
      </div>
    </div>
  );
}
