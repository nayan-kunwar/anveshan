"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, getSubscription, logout, me, putSubscription } from "../lib/api";
import type { Subscription, User } from "../lib/api";
import Sidebar from "../components/Sidebar";
import TimezonePicker from "../components/TimezonePicker";
import Toggle from "../components/Toggle";
import Topbar from "../components/Topbar";
import {
  formatDigestInstant,
  formatWallTime12h,
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
  // Curated majors first so zones like Asia/Kolkata stay findable even
  // when the browser's enumeration omits them. The stored value is
  // always appended (legacy spellings keep working).
  const timezoneOptions = useMemo(() => {
    const options = buildTimezoneOptions(timezones);
    const current = digestTimezone.trim();
    if (current && !options.includes(current)) options.push(current);
    return options;
  }, [timezones, digestTimezone]);
  const timezoneValid = frequency !== "daily" || isValidTimezone(digestTimezone.trim());
  // Banner preview, rendered in the digest zone (same instant as the
  // API's nextDigestAt, mockup format). Null hides the sentence.
  const nextDigestLine =
    frequency === "daily" && nextDigestAt
      ? formatDigestInstant(new Date(nextDigestAt), digestTimezone)
      : null;

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
          <label className="field">
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
              <div className="field-grid">
                <label className="field">
                  Digest time
                  <input
                    type="time"
                    value={digestTime}
                    onChange={(e) => setDigestTime(e.target.value)}
                  />
                </label>
                <label className="field">
                  Timezone
                  <TimezonePicker
                    value={digestTimezone}
                    options={timezoneOptions}
                    onChange={setDigestTimezone}
                  />
                </label>
              </div>
              {!timezoneValid ? (
                <p className="error">Unknown timezone — pick one from the list.</p>
              ) : null}
              <div className="info-box">
                <svg
                  className="info-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="8"
                    y1="7.5"
                    x2="8"
                    y2="11"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="5" r="1" fill="currentColor" />
                </svg>
                <p>
                  You&apos;ll get one email per day at{" "}
                  {formatWallTime12h(digestTime) ?? digestTime} ({digestTimezone}),
                  covering the previous 24 hours.
                  {nextDigestLine ? <> Next digest: {nextDigestLine}.</> : null}
                </p>
              </div>
            </>
          ) : null}
          <div className="toggle-row">
            <div>
              <div className="toggle-title">Notify me of new programs</div>
              <div className="toggle-sub">Get an email when a new program is added.</div>
            </div>
            <Toggle
              checked={watchNew}
              label="Notify me of new programs"
              onChange={setWatchNew}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="toggle-title">Watch all programs (asset changes)</div>
              <div className="toggle-sub">Track asset changes across every program.</div>
            </div>
            <Toggle
              checked={watchAll}
              label="Watch all programs (asset changes)"
              onChange={setWatchAll}
            />
          </div>
          <p className="actions">
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
