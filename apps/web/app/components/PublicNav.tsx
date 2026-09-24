"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/programs", label: "Programs" },
];

export default function PublicNav(): ReactNode {
  const pathname = usePathname();
  return (
    <div
      className="topbar public-nav"
      style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem" }}
    >
      <div className="brand">
        <Link href="/">
          Anveshan<span>.</span>
        </Link>
      </div>
      <div className="topbar-right">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname === link.href ? "nav-link active" : "nav-link"}
          >
            {link.label}
          </Link>
        ))}
        <Link href="/login">Sign in</Link>
        <ThemeToggle />
      </div>
    </div>
  );
}
