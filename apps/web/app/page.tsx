import Link from "next/link";
import type { ReactNode } from "react";

export default function Home(): ReactNode {
  return (
    <>
      <h1>Anveshan</h1>
      <p>Bug-bounty program and scope change monitoring.</p>
      <p>
        <Link href="/login">Sign in</Link> to manage email notifications for program scope
        changes.
      </p>
    </>
  );
}
