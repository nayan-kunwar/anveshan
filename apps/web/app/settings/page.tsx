"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, getSubscription, logout, me, putSubscription } from "../lib/api";
import type { Subscription, User } from "../lib/api";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { localDigestTime } from "../lib/datetime";

export default function SettingsPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [frequency, setFrequency] = useState<"immediate" | "daily">("immediate");
  const [watchNew, setWatchNew] = useState(false);
  const [watchAll, setWatchAll] = useState(false);
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

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="center">
        <h1>Settings</h1>
        <p>Loading…</p>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  const local = localDigestTime();
  const dailyLabel =
    local === null ? "Daily digest (08:00 UTC)" : `Daily digest (08:00 UTC · ${local})`;

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} active="settings" />
      <div className="content">
        <Topbar title="Settings" email={user.email} />

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
              <option value="daily">{dailyLabel}</option>
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

        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
