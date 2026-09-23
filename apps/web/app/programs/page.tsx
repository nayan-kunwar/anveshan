"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { logout, me } from "../lib/api";
import type { User } from "../lib/api";
import ProgramCatalog from "../components/ProgramCatalog";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

export default function ProgramsPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
    } catch {
      // Visitor: catalog stays public, watched filter hidden.
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  const body = <ProgramCatalog user={user} />;

  if (!user) {
    return (
      <>
        <div
          className="topbar"
          style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}
        >
          <div className="brand">
            <Link href="/">
              Anveshan<span>.</span>
            </Link>
          </div>
          <div className="topbar-right">
            <Link href="/programs">Programs</Link>
            <Link href="/login">Sign in</Link>
          </div>
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 2rem" }}>
          {body}
        </div>
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} active="programs" />
      <div className="content">
        <Topbar title="Programs" email={user.email} />
        {body}
      </div>
    </div>
  );
}
