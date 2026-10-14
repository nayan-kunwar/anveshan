"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import { USE_CASES } from "./lib/useCases";
import PublicNav from "./components/PublicNav";

const STEPS = [
  {
    title: "Collect",
    body: "Programs and scopes are pulled from the HackerOne API on a schedule.",
  },
  {
    title: "Diff",
    body: "Each run is compared with the last snapshot: new programs, assets added, assets removed.",
  },
  {
    title: "Notify",
    body: "Watch the programs you hunt and get an immediate email or one daily digest.",
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
        <p className="eyebrow">Bug bounty scope monitoring</p>
        <h1>
          Never miss a<br />
          <span className="accent">scope change</span>
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
      <div className="page-wrap">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="step-num">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <h2 className="section-title">Use cases</h2>
        <div className="features">
          {USE_CASES.map((useCase) => (
            <div className="card feature-card" key={useCase.title}>
              <span className="icon-tile">{useCase.icon}</span>
              <h2>{useCase.title}</h2>
              <p className="desc">{useCase.desc}</p>
              <Link href={useCase.href} className="card-link">
                {useCase.action} →
              </Link>
            </div>
          ))}
        </div>
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
      <footer className="site-foot">
        Anveshan · scope monitoring for bug bounty hunters
      </footer>
    </>
  );
}
