"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { me } from "./lib/api";
import { USE_CASES } from "./lib/useCases";
import PublicNav from "./components/PublicNav";
import { displaySerif } from "./fonts";

function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const STEPS = [
  {
    title: "Collect",
    body: "Scopes are pulled from the HackerOne API on a schedule.",
    icon: (
      <Icon>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </Icon>
    ),
  },
  {
    title: "Diff",
    body: "Each run is compared with the last snapshot.",
    icon: (
      <Icon>
        <path d="M8 3v18" />
        <path d="m4 7 4-4 4 4" />
        <path d="M16 21V3" />
        <path d="m20 17-4 4-4-4" />
      </Icon>
    ),
  },
  {
    title: "Notify",
    body: "Get an immediate email or one daily digest.",
    icon: (
      <Icon>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </Icon>
    ),
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
    <div className={`home ${displaySerif.variable}`}>
      <PublicNav />
      <section className="home-hero">
        <p className="home-pill">
          <span className="home-pill-dot" aria-hidden="true" />
          Bug bounty scope change monitor
        </p>
        <h1 className="home-title">Never miss a scope change</h1>
        <p className="home-sub">
          Anveshan tracks bug bounty program scopes and notifies you the moment something
          changes.
        </p>
        <div className="home-cta">
          <Link href="/login" className="home-btn">
            Get notified →
          </Link>
          <Link href="/programs" className="home-link">
            Browse programs
          </Link>
        </div>
      </section>

      <section className="home-section" aria-labelledby="how-title">
        <h2 id="how-title" className="home-label">
          How it works
        </h2>
        <ol className="home-flow">
          {STEPS.map((step) => (
            <li key={step.title}>
              <span className="home-flow-icon" aria-hidden="true">
                {step.icon}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section" aria-labelledby="uses-title">
        <h2 id="uses-title" className="home-label">
          Use cases
        </h2>
        <ul className="home-uses">
          {USE_CASES.map((useCase) => (
            <li key={useCase.title}>
              <h3>{useCase.title}</h3>
              <p>{useCase.desc}</p>
              <Link href={useCase.href} className="home-link">
                {useCase.action} →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section home-closing">
        <h2 className="home-closing-title">Stay ahead of scope changes</h2>
        <Link href="/login" className="home-link">
          Get notified →
        </Link>
      </section>

      <footer className="home-foot">
        Anveshan · scope monitoring for bug bounty hunters
      </footer>
    </div>
  );
}
