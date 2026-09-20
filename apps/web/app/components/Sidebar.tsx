import Link from "next/link";
import type { ReactNode } from "react";

export default function Sidebar({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        Anveshan<span>.</span>
      </div>
      <nav className="nav">
        <Link href="/dashboard" className="active">
          Dashboard
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
