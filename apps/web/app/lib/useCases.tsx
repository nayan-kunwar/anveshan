import type { ReactNode } from "react";

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

export interface UseCase {
  icon: ReactNode;
  title: string;
  desc: string;
  href: string;
  action: string;
}

export const USE_CASES: UseCase[] = [
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
