"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, listPrograms, listWatches, logout, me } from "../lib/api";
import type { Program, User } from "../lib/api";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

const PAGE_SIZE = 25;

export default function ProgramsPage(): ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const meRes = await me();
      setUser(meRes.data);
      const watchesRes = await listWatches();
      setWatchedIds(new Set(watchesRes.data.map((w) => w.programId)));
    } catch {
      // Visitor: catalog stays public, watched filter hidden.
    }
  }, []);

  const loadPage = useCallback(async (next: number) => {
    setError(null);
    try {
      const res = await listPrograms(next, PAGE_SIZE);
      setPrograms(res.data);
      setPage(res.pagination.page);
      setTotal(res.pagination.total);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load programs");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  async function onLogout(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  const q = query.trim().toLowerCase();
  const visible = programs.filter((p) => {
    if (watchedOnly && !watchedIds.has(p.id)) return false;
    if (q.length === 0) return true;
    return p.name.toLowerCase().includes(q) || p.externalId.toLowerCase().includes(q);
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const body = (
    <>
      <div className="card">
        <h2>Programs ({total})</h2>
        <p className="desc">
          Every program in the HackerOne catalog. Search filters this page.
        </p>
        <input
          type="text"
          placeholder="Filter this page…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {user ? (
          <p>
            <label className="row">
              <input
                type="checkbox"
                checked={watchedOnly}
                onChange={(e) => setWatchedOnly(e.target.checked)}
              />
              Watched only
            </label>
          </p>
        ) : null}
      </div>

      <div className="card">
        {!loaded ? (
          <p className="desc">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="desc">
            {total === 0
              ? "No programs tracked yet."
              : watchedOnly
                ? "None of your watched programs are on this page."
                : "No matches on this page."}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Program</th>
                <th>Handle</th>
                <th>Platform</th>
                <th>Tracked</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/programs/${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="small">{p.externalId}</td>
                  <td className="small">{p.platform}</td>
                  <td className="small" title={p.updatedAt}>
                    {new Date(p.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small">
          Page {page} of {pages}
          {page > 1 ? (
            <>
              {" "}
              <button type="button" onClick={() => void loadPage(page - 1)}>
                Previous
              </button>
            </>
          ) : null}
          {page < pages ? (
            <>
              {" "}
              <button type="button" onClick={() => void loadPage(page + 1)}>
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
        <div
          className="topbar"
          style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}
        >
          <div className="brand">
            Anveshan<span>.</span>
          </div>
          <div className="topbar-right">
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
