import type { ReactNode } from "react";
import { savedThemeScript } from "./components/themeScript";
import "./globals.css";

export const metadata = {
  title: "Anveshan",
  description: "Bug-bounty program and scope change monitoring",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: savedThemeScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
