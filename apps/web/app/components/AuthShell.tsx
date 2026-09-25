import Link from "next/link";
import type { ReactNode } from "react";

function RadarLogo(): ReactNode {
  return (
    <svg
      className="auth-logo"
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 12 18.5 5.5" />
    </svg>
  );
}

function BoltIcon(): ReactNode {
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
      <path d="M13 2 3 14h8l-1 8 11-13h-8l1-7z" />
    </svg>
  );
}

function ChartIcon(): ReactNode {
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
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  );
}

function LinkIcon(): ReactNode {
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <BoltIcon />,
    title: "Real-time change detection",
    desc: "Get notified when anything changes.",
  },
  {
    icon: <ChartIcon />,
    title: "Monitor what matters",
    desc: "Track programs, assets and more.",
  },
  {
    icon: <LinkIcon />,
    title: "Stay informed",
    desc: "Custom alerts, flexible subscriptions.",
  },
];

function Brand(): ReactNode {
  return (
    <Link href="/" className="auth-brand-link">
      <RadarLogo />
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
              Track changes
              <br />
              <span className="auth-headline-accent">before they matter.</span>
            </h2>
            <ul className="auth-features">
              {FEATURES.map((feature) => (
                <li key={feature.title}>
                  <span className="auth-feature-icon">{feature.icon}</span>
                  <span>
                    <span className="auth-feature-title">{feature.title}</span>
                    <span className="auth-feature-desc">{feature.desc}</span>
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
