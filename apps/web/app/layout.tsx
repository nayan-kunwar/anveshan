import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Anveshan",
  description: "Bug-bounty program and scope change monitoring",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
