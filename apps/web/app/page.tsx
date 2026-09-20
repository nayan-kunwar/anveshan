"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import ThemeToggle from "./components/ThemeToggle";

async function fetchProgramTotal(): Promise<number | null> {
  try {
    const res = await fetch("/api/v1/programs?page=1&pageSize=1");
    if (!res.ok) return null;
    const body = (await res.json()) as {
      pagination?: { total?: unknown };
    };
    return typeof body.pagination?.total === "number" ? body.pagination.total : null;
  } catch {
    return null;
  }
}

export default function Home(): ReactNode {
  const router = useRouter();
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    me()
      .then(() => {
        router.replace("/dashboard");
      })
      .catch(() => {
        // Visitor: stay on the landing page.
      });
    void fetchProgramTotal().then((n) => {
      if (n !== null) setTotal(n);
    });
  }, [router]);

  return (
    <>
      <div
        className="topbar"
        style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}
      >
        <div className="brand">
          Anveshan<span>.</span>
        </div>
        <div className="topbar-right">
          <ThemeToggle />
          <Link href="/login">Sign in</Link>
        </div>
      </div>
      <div className="hero">
        <h1>
          Never miss a scope change<span>.</span>
        </h1>
        <p>
          Anveshan tracks bug-bounty programs and emails you the moment in-scope assets
          change.
          {total !== null ? ` Currently tracking ${total} programs.` : null}
        </p>
        <div className="cta">
          <Link href="/login" className="primary">
            Get notified
          </Link>
          <Link href="/login">Sign in</Link>
        </div>
      </div>
      <div
        className="features"
        style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem" }}
      >
        <div className="card">
          <h2>Track programs</h2>
          <p className="desc">
            Watch the programs you hunt on. New programs can notify you too.
          </p>
        </div>
        <div className="card">
          <h2>Diff the scope</h2>
          <p className="desc">
            Every collection is diffed: assets added, assets removed, nothing else.
          </p>
        </div>
        <div className="card">
          <h2>Get email alerts</h2>
          <p className="desc">
            Immediate alerts or a daily 08:00 UTC digest. Unsubscribe anytime.
          </p>
        </div>
      </div>
    </>
  );
}
