import type { ReactNode } from "react";

export const metadata = {
  title: "Program",
  description: "Live scope and recent changes for a tracked HackerOne program.",
};

export default function ProgramDetailLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <>{children}</>;
}
