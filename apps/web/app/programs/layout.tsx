import type { ReactNode } from "react";

export const metadata = {
  title: "Programs",
  description:
    "Browse the HackerOne programs Anveshan tracks and inspect their live scope.",
};

export default function ProgramsLayout({ children }: { children: ReactNode }): ReactNode {
  return <>{children}</>;
}
