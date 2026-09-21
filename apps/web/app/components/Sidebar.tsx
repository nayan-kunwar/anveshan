import Link from "next/link";
import type { ReactNode } from "react";

export default function Sidebar({
  email,
  onSignOut,
  active = "dashboard",
}: {
  email: string;
  onSignOut: () => void;
  active?: "dashboard" | "programs" | "settings";
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        Anveshan<span>.</span>
      </div>
      <nav className="nav">
        <Link href="/dashboard" className={active === "dashboard" ? "active" : undefined}>
          Dashboard
        </Link>
        <Link href="/programs" className={active === "programs" ? "active" : undefined}>
          Programs
        </Link>
        <Link href="/settings" className={active === "settings" ? "active" : undefined}>
          Settings
        </Link>
      </nav>
      <div className="sidebar-foot">
        <span>{email}</span>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
