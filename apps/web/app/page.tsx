"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import PublicNav from "./components/PublicNav";

function SearchIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function BellIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function MailIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

const USE_CASES = [
  {
    icon: <SearchIcon />,
    title: "Track programs",
    desc: "Browse the HackerOne catalog. Search any program and inspect its live scope.",
    href: "/programs",
    action: "Browse programs",
  },
  {
    icon: <BellIcon />,
    title: "Diff the scope",
    desc: "Every collection is diffed: assets added, assets removed, nothing else.",
    href: "/programs",
    action: "See changes",
  },
  {
    icon: <MailIcon />,
    title: "Get email alerts",
    desc: "Immediate alerts or a daily digest when your watched programs change.",
    href: "/login",
    action: "Get notified",
  },
];

export default function Home(): ReactNode {
  const router = useRouter();

  useEffect(() => {
    me()
      .then(() => {
        router.replace("/dashboard");
      })
      .catch(() => {
        // Visitor: stay on the landing page.
      });
  }, [router]);

  return (
    <>
      <PublicNav />
      <div className="hero">
        <h1>
          Never miss a scope change<span>.</span>
        </h1>
        <p>
          Anveshan tracks bug-bounty programs and emails you the moment in-scope assets
          change.
        </p>
        <div className="cta">
          <Link href="/login" className="primary">
            Get notified
          </Link>
          <Link href="/programs">Browse programs</Link>
        </div>
      </div>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem" }}>
        <h2 className="section-title">Use cases</h2>
      </div>
      <div
        className="features"
        style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem" }}
      >
        {USE_CASES.map((useCase) => (
          <div className="card" key={useCase.title}>
            <span className="icon-tile">{useCase.icon}</span>
            <h2>{useCase.title}</h2>
            <p className="desc">{useCase.desc}</p>
            <Link href={useCase.href}>{useCase.action} →</Link>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem 2rem" }}>
        <div className="card cta-banner">
          <h2>Stay ahead of scope changes</h2>
          <p className="desc">
            Watch the programs you hunt on and get an email the moment their scope moves.
          </p>
          <Link href="/login" className="btn-accent">
            Get notified
          </Link>
        </div>
      </div>
    </>
  );
}
