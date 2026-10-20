import type { ReactNode } from "react";

export const metadata = {
  title: "Unsubscribe",
};

export default function UnsubscribeLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <>{children}</>;
}
