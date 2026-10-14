"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  getSubscription,
  listAllChanges,
  listPrograms,
  listWatches,
  logout,
  me,
  removeWatch,
} from "../lib/api";
import type { GlobalChange, Subscription, User, WatchedProgram } from "../lib/api";
import { formatDateTime } from "../lib/datetime";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import Topbar from "../components/Topbar";

function pillClass(type: string): string {
  if (type === "ASSET_ADDED") return "pill pill-good";
  if (type === "ASSET_REMOVED") return "pill pill-bad";
  return "pill";
}

function typeLabel(type: string): string {
  if (type === "PROGRAM_ADDED") return "Program added";
  if (type === "ASSET_ADDED") return "Asset added";
  if (type === "ASSET_REMOVED") return "Asset removed";
  return type;
}

export default function DashboardPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [watches, setWatches] = useState<WatchedProgram[]>([]);
  const [trackedTotal, setTrackedTotal] = useState(0);
  const [recent, setRecent] = useState<GlobalChange[]>([]);
  const [recentReady, setRecentReady] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
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
      try {
        const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
        const feed = await listAllChanges({ since, page: 1, pageSize: 5 });
        setRecent(feed.data);
        setRecentError(null);
      } catch (err) {
        setRecentError(
          err instanceof ApiError ? err.message : "Failed to load recent changes",
        );
      } finally {
        setRecentReady(true);
      }
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
        {error ? <p className="error-banner">{error}</p> : null}
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
        <Topbar
          title="Dashboard"
          subtitle="Your watches and the latest scope changes."
          email={user.email}
        />

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
          <div className="card">
            <h2>Notifications are off</h2>
            <p className="desc">
              Save a cadence in settings to start receiving mail about watched changes.
            </p>
            <Link href="/settings" className="card-link">
              Configure notifications →
            </Link>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Watched programs ({watches.length})</h2>
              <p className="desc">Programs that send you asset changes.</p>
            </div>
            <Link href="/programs" className="card-link">
              Browse →
            </Link>
          </div>
          {watches.length === 0 ? (
            <p className="empty">Nothing watched yet.</p>
          ) : (
            <ul className="clean">
              {watches.map((w) => (
                <li key={w.programId}>
                  <span>
                    <Link href={`/programs/${w.programId}`}>{w.name}</Link>{" "}
                    <span className="small">({w.externalId})</span>
                  </span>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => void onRemoveWatch(w.programId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Recent changes</h2>
              <p className="desc">Last 7 days, across every program.</p>
            </div>
            <Link href="/changes" className="card-link">
              View all →
            </Link>
          </div>
          {!recentReady ? (
            <p className="empty">Loading…</p>
          ) : recentError ? (
            <p className="error">{recentError}</p>
          ) : recent.length === 0 ? (
            <p className="empty">No changes in the last 7 days.</p>
          ) : (
            <ul className="clean">
              {recent.map((change) => (
                <li key={change.id}>
                  <span>
                    <span className={pillClass(change.type)}>
                      {typeLabel(change.type)}
                    </span>{" "}
                    <Link href={`/programs/${change.programId}`}>
                      {change.programName}
                    </Link>{" "}
                    <span className="small">
                      {change.assetIdentifier ?? "program"} ·{" "}
                      {formatDateTime(change.detectedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </div>
    </div>
  );
}
