import type { ReactNode } from "react";

export const metadata = {
  title: "Sign in",
};

export default function LoginLayout({ children }: { children: ReactNode }): ReactNode {
  return <>{children}</>;
}
