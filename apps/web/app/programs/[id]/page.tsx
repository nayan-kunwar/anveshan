"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  addWatch,
  getProgram,
  listAssets,
  listChanges,
  listWatches,
  logout,
  me,
  removeWatch,
} from "../../lib/api";
import type { Asset, Change, Program, User } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";
import PublicNav from "../../components/PublicNav";
import Sidebar from "../../components/Sidebar";
import StatCard from "../../components/StatCard";
import Topbar from "../../components/Topbar";

type Scope = "ALL" | "IN" | "OUT";
type SincePreset = "all" | "24h" | "7d";

const PAGE_SIZE = 25;

function sinceIso(preset: SincePreset): string | undefined {
  if (preset === "all") return undefined;
  const hours = preset === "24h" ? 24 : 24 * 7;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function changeSign(type: string): string {
  if (type === "ASSET_ADDED" || type === "PROGRAM_ADDED") return "+";
  if (type === "ASSET_REMOVED") return "−";
  return "•";
}

export default function ProgramDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [user, setUser] = useState<User | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [watched, setWatched] = useState(false);
  const [scope, setScope] = useState<Scope>("IN");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsPage, setAssetsPage] = useState(1);
  const [assetsTotal, setAssetsTotal] = useState(0);
  const [inTotal, setInTotal] = useState(0);
  const [since, setSince] = useState<SincePreset>("7d");
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesPage, setChangesPage] = useState(1);
  const [changesTotal, setChangesTotal] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProgram = useCallback(async () => {
    try {
      const res = await getProgram(id);
      setProgram(res.data);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "PROGRAM_NOT_FOUND" || err.code === "BAD_REQUEST")
      ) {
        setNotFound(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to load program");
    }
  }, [id]);

  const loadSession = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
      const watchesRes = await listWatches();
      setWatched(watchesRes.data.some((w) => w.programId === id));
    } catch {
      // Visitor: page stays public, watch actions redirect to login.
    }
  }, [id]);

  const loadAssets = useCallback(
    async (tab: Scope, page: number) => {
      try {
        const res = await listAssets(id, { scope: tab, page, pageSize: PAGE_SIZE });
        setAssets(res.data);
        setAssetsPage(res.pagination.page);
        setAssetsTotal(res.pagination.total);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load assets");
      }
    },
    [id],
  );

  const loadChanges = useCallback(
    async (preset: SincePreset, page: number) => {
      try {
        const res = await listChanges(id, {
          since: sinceIso(preset),
          page,
          pageSize: PAGE_SIZE,
        });
        setChanges(res.data);
        setChangesPage(res.pagination.page);
        setChangesTotal(res.pagination.total);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load changes");
      }
    },
    [id],
  );

  useEffect(() => {
    void loadProgram();
    void loadSession();
  }, [loadProgram, loadSession]);

  useEffect(() => {
    if (notFound) return;
    void loadAssets(scope, 1);
  }, [scope, notFound, loadAssets]);

  useEffect(() => {
    if (notFound) return;
    void loadChanges(since, 1);
  }, [since, notFound, loadChanges]);

  useEffect(() => {
    // IN total powers the stat card regardless of the active tab.
    if (notFound || scope === "IN") return;
    listAssets(id, { scope: "IN", page: 1, pageSize: 1 })
      .then((res) => {
        setInTotal(res.pagination.total);
      })
      .catch(() => {
        // Stat only; asset list errors surface from loadAssets.
      });
  }, [id, scope, notFound]);

  useEffect(() => {
    if (scope === "IN") setInTotal(assetsTotal);
  }, [scope, assetsTotal]);

  async function onToggleWatch(): Promise<void> {
    if (!user) {
      router.push("/login");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (watched) await removeWatch(id);
      else await addWatch(id);
      setWatched(!watched);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Watch update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  if (notFound) {
    return (
      <div className="center">
        <h1>Program not found</h1>
        <p>No program exists with this id.</p>
        <p>
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="center">
        <h1>Program</h1>
        <p>Loading…</p>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  const assetsPages = Math.max(1, Math.ceil(assetsTotal / PAGE_SIZE));
  const changesPages = Math.max(1, Math.ceil(changesTotal / PAGE_SIZE));

  const body = (
    <>
      <p>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <div className="stats">
        <StatCard label="In-scope assets" value={String(inTotal)} sub="scope IN" />
        <StatCard label="Changes" value={String(changesTotal)} sub="detected to date" />
        <StatCard label="Platform" value={program.platform} sub={program.externalId} />
      </div>

      <div className="card">
        <h2>{program.name}</h2>
        <p className="desc">
          {program.platform} · {program.externalId}
          {program.url ? (
            <>
              {" · "}
              <a href={program.url} target="_blank" rel="noreferrer">
                HackerOne profile
              </a>
            </>
          ) : null}
        </p>
        <p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void onToggleWatch()}
          >
            {watched ? "Unwatch" : "Watch"}
          </button>{" "}
          {watched ? <span className="good">Watched.</span> : null}
        </p>
      </div>

      <div className="card">
        <h2>Assets ({assetsTotal})</h2>
        <p className="desc">Scope filter — IN is what notifications cover.</p>
        <p>
          {(["IN", "OUT", "ALL"] as Scope[]).map((tab) => (
            <span key={tab}>
              <button
                type="button"
                disabled={tab === scope}
                onClick={() => {
                  setScope(tab);
                }}
              >
                {tab}
              </button>{" "}
            </span>
          ))}
        </p>
        {assets.length === 0 ? (
          <p className="desc">No {scope}-scope assets.</p>
        ) : (
          <ul className="clean">
            {assets.map((a) => (
              <li key={a.id}>
                <span>
                  {a.identifier}{" "}
                  <span className="small">
                    ({a.type} · {a.scope})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small">
          Page {assetsPage} of {assetsPages}
          {assetsPage > 1 ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadAssets(scope, assetsPage - 1)}
              >
                Prev
              </button>
            </>
          ) : null}
          {assetsPage < assetsPages ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadAssets(scope, assetsPage + 1)}
              >
                Next
              </button>
            </>
          ) : null}
        </p>
      </div>

      <div className="card">
        <h2>Changes ({changesTotal})</h2>
        <p className="desc">Newest first.</p>
        <p>
          {(["7d", "24h", "all"] as SincePreset[]).map((preset) => (
            <span key={preset}>
              <button
                type="button"
                disabled={preset === since}
                onClick={() => {
                  setSince(preset);
                }}
              >
                {preset === "all"
                  ? "All time"
                  : preset === "24h"
                    ? "Last 24h"
                    : "Last 7 days"}
              </button>{" "}
            </span>
          ))}
        </p>
        {changes.length === 0 ? (
          <p className="desc">No changes in this window.</p>
        ) : (
          <ul className="clean">
            {changes.map((c) => (
              <li key={c.id}>
                <span>
                  {changeSign(c.type)} {c.type}{" "}
                  <span className="small">
                    {c.assetIdentifier ?? "program"} · {formatDateTime(c.detectedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small">
          Page {changesPage} of {changesPages}
          {changesPage > 1 ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadChanges(since, changesPage - 1)}
              >
                Prev
              </button>
            </>
          ) : null}
          {changesPage < changesPages ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void loadChanges(since, changesPage + 1)}
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
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem 2rem" }}>
          {body}
        </div>
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar email={user.email} onSignOut={() => void onLogout()} />
      <div className="content">
        <Topbar title={program.name} email={user.email} />
        {body}
      </div>
    </div>
  );
}
