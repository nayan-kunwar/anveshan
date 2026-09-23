"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import ProgramCatalog from "./components/ProgramCatalog";
import ThemeToggle from "./components/ThemeToggle";

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
      <div
        className="topbar"
        style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}
      >
        <div className="brand">
          <Link href="/">
            Anveshan<span>.</span>
          </Link>
        </div>
        <div className="topbar-right">
          <ThemeToggle />
          <Link href="/programs">Programs</Link>
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
        </p>
        <div className="cta">
          <Link href="/login" className="primary">
            Get notified
          </Link>
          <a href="#programs">Browse programs</a>
        </div>
      </div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem" }}>
        <section id="programs">
          <ProgramCatalog user={null} />
        </section>
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
