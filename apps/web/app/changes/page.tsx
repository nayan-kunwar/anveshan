"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, listAllChanges, logout, me } from "../lib/api";
import type { ChangeTypeFilter, GlobalChange, User } from "../lib/api";
import { formatDateTime } from "../lib/datetime";
import Pager from "../components/Pager";
import PublicNav from "../components/PublicNav";
import Segmented from "../components/Segmented";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

type SincePreset = "all" | "24h" | "7d";
type TypeTab = "ALL" | ChangeTypeFilter;

const PAGE_SIZE = 25;

const SINCE_TABS: { value: SincePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "24h", label: "Last 24h" },
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
        {user ? <h2>Changes ({total})</h2> : <h1>Changes ({total})</h1>}
        <p className="desc">Newest detected changes across all programs.</p>
        <div className="filters">
          <Segmented
            label="Time window"
            value={since}
            options={SINCE_TABS}
            onChange={setSince}
          />
          <Segmented
            label="Change type"
            value={typeTab}
            options={TYPE_TABS}
            onChange={setTypeTab}
          />
        </div>
      </div>

      <div className="card">
        {!loaded ? (
          <p className="empty">Loading…</p>
        ) : error && changes.length === 0 ? (
          <p className="empty">Could not load changes.</p>
        ) : changes.length === 0 ? (
          <p className="empty">No changes in this view.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Change</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Program</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Time</th>
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
        {changes.length > 0 || !error ? (
          <Pager
            page={page}
            pages={pages}
            summary={`Page ${page} of ${pages}`}
            onPrev={() => void loadPage(page - 1, since, typeTab)}
            onNext={() => void loadPage(page + 1, since, typeTab)}
          />
        ) : null}
      </div>

      {error ? <p className="error-banner">{error}</p> : null}
    </>
  );

  if (!user) {
    return (
      <>
        <PublicNav />
        <div className="page-wrap">{body}</div>
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} active="changes" />
      <div className="content">
        <Topbar
          title="Changes"
          subtitle="Scope changes across the catalog."
          email={user.email}
        />
        {body}
      </div>
    </div>
  );
}
