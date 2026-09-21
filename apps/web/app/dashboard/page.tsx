"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  addWatch,
  getSubscription,
  listAllPrograms,
  listWatches,
  logout,
  me,
  putSubscription,
  removeWatch,
} from "../lib/api";
import type { Program, Subscription, User, WatchedProgram } from "../lib/api";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import Topbar from "../components/Topbar";

export default function DashboardPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [frequency, setFrequency] = useState<"immediate" | "daily">("immediate");
  const [watchNew, setWatchNew] = useState(false);
  const [watchAll, setWatchAll] = useState(false);
  const [watches, setWatches] = useState<WatchedProgram[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
      const subRes = await getSubscription();
      setSub(subRes.data);
      if (subRes.data) {
        setFrequency(subRes.data.frequency);
        setWatchNew(subRes.data.watchNewPrograms);
        setWatchAll(subRes.data.watchAllPrograms);
      }
      const watchesRes = await listWatches();
      setWatches(watchesRes.data);
      setPrograms(await listAllPrograms());
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

  async function onSave(): Promise<void> {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await putSubscription({
        frequency,
        watchNewPrograms: watchNew,
        watchAllPrograms: watchAll,
      });
      setSub(res.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAddWatch(programId: string): Promise<void> {
    setError(null);
    try {
      await addWatch(programId);
      setWatches((await listWatches()).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Add failed");
    }
  }

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

  const watchedIds = new Set(watches.map((w) => w.programId));
  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : programs
          .filter(
            (p) =>
              !watchedIds.has(p.id) &&
              (p.name.toLowerCase().includes(q) ||
                p.externalId.toLowerCase().includes(q)),
          )
          .slice(0, 10);

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
  const scope = watchAll
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
            value={String(programs.length)}
            sub="in the HackerOne catalog"
          />
          <StatCard label="Email cadence" value={cadence} sub="delivery frequency" />
          <StatCard label="Watch scope" value={scope} sub="notification coverage" />
        </div>

        <div className="card">
          <h2>Watch program scope</h2>
          <p className="desc">
            Search the catalog and watch programs. You get mail when watched scope
            changes. <Link href="/programs">Browse all →</Link>
          </p>
          <input
            type="text"
            placeholder="Search programs…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {matches.length > 0 ? (
            <ul className="clean">
              {matches.map((p) => (
                <li key={p.id}>
                  <span>
                    <Link href={`/programs/${p.id}`}>{p.name}</Link>{" "}
                    <span className="small">({p.externalId})</span>
                  </span>
                  <button type="button" onClick={() => void onAddWatch(p.id)}>
                    Watch
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="card">
          <h2>Notifications</h2>
          <p className="desc">How often Anveshan emails you about watched changes.</p>
          <label className="row">
            Frequency
            <select
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as "immediate" | "daily")
              }
            >
              <option value="immediate">Immediate (after each collection)</option>
              <option value="daily">Daily digest (08:00 UTC)</option>
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={watchNew}
              onChange={(e) => setWatchNew(e.target.checked)}
            />
            Notify me of new programs
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={watchAll}
              onChange={(e) => setWatchAll(e.target.checked)}
            />
            Watch all programs (asset changes)
          </label>
          <p>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void onSave()}
            >
              {busy ? "Saving…" : "Save"}
            </button>{" "}
            {saved ? <span className="good">Saved.</span> : null}
            {sub ? null : (
              <span className="small">
                {" "}
                No subscription yet — save to start receiving mail.
              </span>
            )}
          </p>
        </div>

        <div className="card">
          <h2>Watched programs ({watches.length})</h2>
          {watches.length === 0 ? (
            <p className="desc">Nothing watched yet. Search above to add programs.</p>
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
