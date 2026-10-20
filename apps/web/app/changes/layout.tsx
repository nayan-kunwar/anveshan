import type { ReactNode } from "react";

export const metadata = {
  title: "Changes",
  description: "Recent scope changes across the programs Anveshan monitors.",
};

export default function ChangesLayout({ children }: { children: ReactNode }): ReactNode {
  return <>{children}</>;
}
