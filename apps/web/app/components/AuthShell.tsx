import Link from "next/link";
import type { ReactNode } from "react";
import RadarLogo from "./RadarLogo";
import { USE_CASES } from "../lib/useCases";

function Brand(): ReactNode {
  return (
    <Link href="/" className="auth-brand-link">
      <RadarLogo className="auth-logo" />
      <span>
        <span className="auth-brand-name">Anveshan</span>
        <span className="auth-tagline">Monitor • Detect • Stay ahead</span>
      </span>
    </Link>
  );
}

export default function AuthShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="auth-page">
      <aside className="auth-panel">
        <div className="auth-grid" aria-hidden="true" />
        <div className="auth-panel-inner">
          <Brand />
          <div className="auth-hero">
            <h2 className="auth-headline">
              Never miss
              <br />
              <span className="auth-headline-accent">a scope change</span>
            </h2>
            <ul className="auth-features">
              {USE_CASES.map((useCase) => (
                <li key={useCase.title}>
                  <span className="auth-feature-icon">{useCase.icon}</span>
                  <span>
                    <span className="auth-feature-title">{useCase.title}</span>
                    <span className="auth-feature-desc">{useCase.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="auth-footnote">Open source. Built for the community.</p>
        </div>
      </aside>
      <main className="auth-side">
        <div className="auth-compact-brand">
          <Brand />
        </div>
        <div className="auth-form">{children}</div>
      </main>
    </div>
  );
}
