"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  getSubscription,
  listPrograms,
  listWatches,
  logout,
  me,
  removeWatch,
} from "../lib/api";
import type { Subscription, User, WatchedProgram } from "../lib/api";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import Topbar from "../components/Topbar";

export default function DashboardPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [watches, setWatches] = useState<WatchedProgram[]>([]);
  const [trackedTotal, setTrackedTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
      const subRes = await getSubscription();
      setSub(subRes.data);
      const watchesRes = await listWatches();
      setWatches(watchesRes.data);
      // Cheap total for the stat card (one row, server counts).
      const catalog = await listPrograms(1, 1);
      setTrackedTotal(catalog.pagination.total);
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to load");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRemoveWatch(programId: string): Promise<void> {
    setError(null);
    try {
      await removeWatch(programId);
      setWatches((await listWatches()).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed");
    }
  }

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="center">
        <h1>Dashboard</h1>
        <p>Loading…</p>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  const cadence =
    sub === null ? "Off" : sub.frequency === "immediate" ? "Immediate" : "Daily";
  const scope =
    sub !== null && sub.watchAllPrograms
      ? "All programs"
      : watches.length > 0
        ? `${watches.length} watched`
        : "Nothing yet";

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} />
      <div className="content">
        <Topbar title="Dashboard" email={user.email} />

        <div className="stats">
          <StatCard
            label="Watched programs"
            value={String(watches.length)}
            sub="in your watch list"
          />
          <StatCard
            label="Programs tracked"
            value={String(trackedTotal)}
            sub="in the HackerOne catalog"
          />
          <StatCard label="Email cadence" value={cadence} sub="delivery frequency" />
          <StatCard label="Watch scope" value={scope} sub="notification coverage" />
        </div>

        {sub ? null : (
          <p className="desc">
            No subscription yet — <Link href="/settings">configure notifications</Link> to
            start receiving mail.
          </p>
        )}

        <div className="card">
          <h2>Watched programs ({watches.length})</h2>
          {watches.length === 0 ? (
            <p className="desc">
              Nothing watched yet. <Link href="/programs">Browse programs</Link> to add
              some.
            </p>
          ) : (
            <ul className="clean">
              {watches.map((w) => (
                <li key={w.programId}>
                  <span>
                    <Link href={`/programs/${w.programId}`}>{w.name}</Link>{" "}
                    <span className="small">({w.externalId})</span>
                  </span>
                  <button type="button" onClick={() => void onRemoveWatch(w.programId)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
