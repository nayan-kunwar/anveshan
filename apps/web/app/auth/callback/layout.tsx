import type { ReactNode } from "react";

export const metadata = {
  title: "Signing in",
};

export default function AuthCallbackLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <>{children}</>;
}
