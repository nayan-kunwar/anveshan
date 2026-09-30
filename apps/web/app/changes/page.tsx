"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, listAllChanges, logout, me } from "../lib/api";
import type { ChangeTypeFilter, GlobalChange, User } from "../lib/api";
import { formatDateTime } from "../lib/datetime";
import PublicNav from "../components/PublicNav";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

type SincePreset = "all" | "24h" | "7d";
type TypeTab = "ALL" | ChangeTypeFilter;

const PAGE_SIZE = 25;

const SINCE_TABS: { value: SincePreset; label: string }[] = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PROGRAM_ADDED", label: "Program added" },
  { value: "ASSET_ADDED", label: "Asset added" },
  { value: "ASSET_REMOVED", label: "Asset removed" },
];

function sinceIso(preset: SincePreset): string | undefined {
  if (preset === "all") return undefined;
  const hours = preset === "24h" ? 24 : 24 * 7;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

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

export default function ChangesPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [changes, setChanges] = useState<GlobalChange[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [since, setSince] = useState<SincePreset>("7d");
  const [typeTab, setTypeTab] = useState<TypeTab>("ALL");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
    } catch {
      // Visitor: the global feed is public.
    }
  }, []);

  const loadPage = useCallback(
    async (next: number, preset: SincePreset, tab: TypeTab) => {
      setError(null);
      try {
        const res = await listAllChanges({
          since: sinceIso(preset),
          type: tab === "ALL" ? undefined : tab,
          page: next,
          pageSize: PAGE_SIZE,
        });
        setChanges(res.data);
        setPage(res.pagination.page);
        setTotal(res.pagination.total);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load changes");
        setLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadPage(1, since, typeTab);
  }, [since, typeTab, loadPage]);

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const body = (
    <>
      <div className="card">
        <h2>Changes ({total})</h2>
        <p className="desc">Newest detected changes across all programs.</p>
        <div role="group" aria-label="Time window">
          {SINCE_TABS.map((tab) => (
            <span key={tab.value}>
              <button
                type="button"
                aria-pressed={tab.value === since}
                className={tab.value === since ? "seg-active" : undefined}
                onClick={() => setSince(tab.value)}
              >
                {tab.label}
              </button>{" "}
            </span>
          ))}
        </div>
        <div role="group" aria-label="Change type" style={{ marginTop: "0.75rem" }}>
          {TYPE_TABS.map((tab) => (
            <span key={tab.value}>
              <button
                type="button"
                aria-pressed={tab.value === typeTab}
                className={tab.value === typeTab ? "seg-active" : undefined}
                onClick={() => setTypeTab(tab.value)}
              >
                {tab.label}
              </button>{" "}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        {!loaded ? (
          <p className="desc">Loading…</p>
        ) : changes.length === 0 ? (
          <p className="desc">No changes in this view.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Asset</th>
                  <th>Program</th>
                  <th>Platform</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className={pillClass(c.type)}>{typeLabel(c.type)}</span>
                    </td>
                    <td className="small">{c.assetIdentifier ?? "—"}</td>
                    <td>
                      <Link href={`/programs/${c.programId}`}>{c.programName}</Link>
                    </td>
                    <td>
                      <span className="pill">{c.platform}</span>
                    </td>
                    <td className="small">{formatDateTime(c.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small">
          Page {page} of {pages}
          {page > 1 ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadPage(page - 1, since, typeTab)}
              >
                Prev
              </button>
            </>
          ) : null}
          {page < pages ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadPage(page + 1, since, typeTab)}
              >
                Next
              </button>
            </>
          ) : null}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </>
  );

  if (!user) {
    return (
      <>
        <PublicNav />
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem 1rem 2rem" }}>
          {body}
        </div>
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} active="changes" />
      <div className="content">
        <Topbar title="Changes" email={user.email} />
        {body}
      </div>
    </div>
  );
}
