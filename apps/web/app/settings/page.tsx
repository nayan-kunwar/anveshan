"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, getSubscription, logout, me, putSubscription } from "../lib/api";
import type { Subscription, User } from "../lib/api";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import {
  formatDateTime,
  convertWallTime,
  buildTimezoneOptions,
  isValidTimezone,
} from "../lib/datetime";

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function availableTimezones(): string[] {
  try {
    const values = (
      Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf?.("timeZone");
    if (values && values.length > 0) return values;
  } catch {
    // Fall through to the minimal list below.
  }
  return ["UTC"];
}

export default function SettingsPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [frequency, setFrequency] = useState<"immediate" | "daily">("immediate");
  const [watchNew, setWatchNew] = useState(false);
  const [watchAll, setWatchAll] = useState(false);
  const [digestTime, setDigestTime] = useState("08:00");
  const [digestTimezone, setDigestTimezone] = useState<string>(() => browserTimezone());
  const [nextDigestAt, setNextDigestAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const timezones = useMemo(() => availableTimezones(), []);
  const browserTz = useMemo(() => browserTimezone(), []);
  // Searchable picker: curated majors first so zones like Asia/Kolkata
  // stay findable even when the browser's enumeration omits them. The
  // stored value is always appended (legacy spellings keep working).
  const timezoneOptions = useMemo(() => {
    const options = buildTimezoneOptions(timezones);
    const current = digestTimezone.trim();
    if (current && !options.includes(current)) options.push(current);
    return options;
  }, [timezones, digestTimezone]);
  const timezoneValid = frequency !== "daily" || isValidTimezone(digestTimezone.trim());

  // Guardrail: the typed time is interpreted in the selected zone, not
  // the viewer's zone. Spell out the local equivalent on mismatch so a
  // "my time vs UTC" mix-up is visible before Save.
  const localHint = useMemo(() => {
    if (frequency !== "daily") return null;
    if (!digestTimezone || digestTimezone === browserTz) return null;
    const converted = convertWallTime(digestTime, digestTimezone);
    if (!converted) return null;
    return `That's ${converted} your time (${browserTz}) — double-check the timezone.`;
  }, [frequency, digestTimezone, digestTime, browserTz]);

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
        setDigestTime(subRes.data.digestTimeLocal);
        setDigestTimezone(subRes.data.digestTimezone);
        setNextDigestAt(subRes.data.nextDigestAt);
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
        digestTimezone: digestTimezone.trim(),
        digestTimeLocal: digestTime,
      });
      setSub(res.data);
      setNextDigestAt(res.data.nextDigestAt);
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
              <option value="daily">Daily digest</option>
            </select>
          </label>
          {frequency === "daily" ? (
            <>
              <label className="row">
                Digest time
                <input
                  type="time"
                  value={digestTime}
                  onChange={(e) => setDigestTime(e.target.value)}
                />
              </label>
              <label className="row">
                Timezone
                <input
                  list="tz-list"
                  value={digestTimezone}
                  placeholder="Type to search, e.g. Asia/Kolkata"
                  onChange={(e) => setDigestTimezone(e.target.value)}
                />
                <datalist id="tz-list">
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </label>
              {!timezoneValid ? (
                <p className="error">Unknown timezone — pick one from the list.</p>
              ) : null}
              <p className="desc">
                One email per day covering the 24 hours before {digestTime} (
                {digestTimezone}
                ).
                {nextDigestAt ? <> Next digest: {formatDateTime(nextDigestAt)}.</> : null}
              </p>
              {localHint ? <p className="desc">{localHint}</p> : null}
            </>
          ) : null}
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
              disabled={busy || !timezoneValid}
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
