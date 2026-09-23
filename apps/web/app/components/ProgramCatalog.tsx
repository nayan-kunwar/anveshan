"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, addWatch, listPrograms, listWatches, removeWatch } from "../lib/api";
import type { Program, User } from "../lib/api";
import { formatDateTime } from "../lib/datetime";

const PAGE_SIZE = 25;

export default function ProgramCatalog({ user }: { user: User | null }): ReactNode {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    if (!user) return;
    try {
      setWatchedIds(new Set((await listWatches()).data.map((w) => w.programId)));
    } catch {
      // Watch state is decoration; the catalog stays usable without it.
    }
  }, [user]);

  const loadPage = useCallback(async (next: number, search?: string) => {
    setError(null);
    try {
      const res = await listPrograms(next, PAGE_SIZE, search);
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
    void loadWatches();
  }, [loadWatches]);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      void loadPage(1, trimmed ? trimmed : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loadPage]);

  async function onToggleWatch(programId: string): Promise<void> {
    if (!user) {
      router.push("/login");
      return;
    }
    setError(null);
    setWatchBusy(programId);
    try {
      if (watchedIds.has(programId)) await removeWatch(programId);
      else await addWatch(programId);
      setWatchedIds(new Set((await listWatches()).data.map((w) => w.programId)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Watch update failed");
    } finally {
      setWatchBusy(null);
    }
  }

  const visible = watchedOnly ? programs.filter((p) => watchedIds.has(p.id)) : programs;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const activeQuery = query.trim() ? query.trim() : undefined;

  return (
    <>
      <div className="card">
        <h2>Programs ({total})</h2>
        <p className="desc">
          Every program in the HackerOne catalog. Search across all programs.
        </p>
        <input
          type="text"
          placeholder="Search name or handle…"
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
              ? query.trim()
                ? "No programs match your search."
                : "No programs tracked yet."
              : watchedOnly
                ? "None of your watched programs match this search."
                : "No matches."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Handle</th>
                  <th>Platform</th>
                  <th>Tracked</th>
                  {user ? <th>Watch</th> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/programs/${p.id}`}>{p.name}</Link>
                    </td>
                    <td className="small">{p.externalId}</td>
                    <td>
                      <span className="pill">{p.platform}</span>
                    </td>
                    <td className="small" title={p.updatedAt}>
                      {formatDateTime(p.updatedAt)}
                    </td>
                    {user ? (
                      <td>
                        <button
                          type="button"
                          disabled={watchBusy === p.id}
                          onClick={() => void onToggleWatch(p.id)}
                        >
                          {watchedIds.has(p.id) ? "Unwatch" : "Watch"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small">
          Showing {rangeStart}–{rangeEnd} of {total} · Page {page} of {pages}
          {page > 1 ? (
            <>
              {" "}
              <button type="button" onClick={() => void loadPage(page - 1, activeQuery)}>
                Previous
              </button>
            </>
          ) : null}
          {page < pages ? (
            <>
              {" "}
              <button type="button" onClick={() => void loadPage(page + 1, activeQuery)}>
                Next
              </button>
            </>
          ) : null}
        </p>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
