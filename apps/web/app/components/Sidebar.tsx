import Link from "next/link";
import type { ReactNode } from "react";
import RadarLogo from "./RadarLogo";

export default function Sidebar({
  email,
  onSignOut,
  active = "dashboard",
}: {
  email: string;
  onSignOut: () => void;
  active?: "dashboard" | "programs" | "changes" | "settings";
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        <RadarLogo size={24} />
        Anveshan
      </div>
      <nav className="nav">
        <Link href="/dashboard" className={active === "dashboard" ? "active" : undefined}>
          Dashboard
        </Link>
        <Link href="/programs" className={active === "programs" ? "active" : undefined}>
          Programs
        </Link>
        <Link href="/changes" className={active === "changes" ? "active" : undefined}>
          Changes
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
