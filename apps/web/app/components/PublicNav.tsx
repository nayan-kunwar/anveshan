"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import RadarLogo from "./RadarLogo";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/programs", label: "Programs" },
  { href: "/changes", label: "Changes" },
];

function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function PublicNav(): ReactNode {
  const pathname = usePathname();
  return (
    <header className="public-nav">
      <div className="public-nav-inner">
        <div className="brand">
          <Link href="/">
            <RadarLogo size={22} />
            Anveshan
          </Link>
        </div>
        <nav className="public-links" aria-label="Main">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={isActive(link.href, pathname) ? "nav-link active" : "nav-link"}
              aria-current={isActive(link.href, pathname) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="public-actions">
          <ThemeToggle />
          <Link href="/login" className="nav-signin">
            Sign in →
          </Link>
        </div>
      </div>
    </header>
  );
}
