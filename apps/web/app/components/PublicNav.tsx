"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import RadarLogo from "./RadarLogo";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/programs", label: "Programs" },
  { href: "/changes", label: "Changes" },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
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
        <div className="public-links">
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
          <Link href="/login" className="btn-accent nav-signin">
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
