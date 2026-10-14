import Link from "next/link";
import type { ReactNode } from "react";
import RadarLogo from "./RadarLogo";

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const LINKS = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  },
  {
    id: "programs",
    href: "/programs",
    label: "Programs",
    icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  },
  {
    id: "changes",
    href: "/changes",
    label: "Changes",
    icon: "M3 12h4l2-6 4 12 2-6h6",
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  },
] as const;

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
        <Link href="/dashboard">
          <RadarLogo size={22} />
          Anveshan
        </Link>
      </div>
      <nav className="nav" aria-label="Account">
        {LINKS.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className={active === link.id ? "active" : undefined}
            aria-current={active === link.id ? "page" : undefined}
          >
            <Icon d={link.icon} />
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="sidebar-email" title={email}>
          {email}
        </span>
        <button type="button" className="ghost btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
