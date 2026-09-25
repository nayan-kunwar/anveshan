"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import { USE_CASES } from "./lib/useCases";
import PublicNav from "./components/PublicNav";

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
        <h1>Never miss a scope change</h1>
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
            <Link href={useCase.href} className="card-link">
              {useCase.action} →
            </Link>
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
