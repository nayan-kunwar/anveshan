"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, addWatch, listPrograms, listWatches, removeWatch } from "../lib/api";
import type { Program, User } from "../lib/api";
import { formatDateTime } from "../lib/datetime";
import Pager from "./Pager";
import Segmented from "./Segmented";

const PAGE_SIZE = 25;

type CatalogSort = "name" | "newest";

export default function ProgramCatalog({ user }: { user: User | null }): ReactNode {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CatalogSort>("newest");
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

  const loadPage = useCallback(
    async (next: number, search?: string, sortOrder?: CatalogSort) => {
      setError(null);
      try {
        const res = await listPrograms(next, PAGE_SIZE, search, sortOrder ?? "newest");
        setPrograms(res.data);
        setPage(res.pagination.page);
        setTotal(res.pagination.total);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load programs");
        setLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    void loadWatches();
  }, [loadWatches]);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      void loadPage(1, trimmed ? trimmed : undefined, sort);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, sort, loadPage]);

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
        <div className="toolbar">
          <div className="search">
            <input
              type="text"
              placeholder="Search name or handle…"
              aria-label="Search programs"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <Segmented
            label="Sort programs"
            value={sort}
            options={[
              { value: "newest", label: "Newest" },
              { value: "name", label: "Name" },
            ]}
            onChange={setSort}
          />
          {user ? (
            <label className="chip-check">
              <input
                type="checkbox"
                checked={watchedOnly}
                onChange={(e) => setWatchedOnly(e.target.checked)}
              />
              Watched only
            </label>
          ) : null}
        </div>
      </div>

      <div className="card">
        {!loaded ? (
          <p className="empty">Loading…</p>
        ) : error && programs.length === 0 ? (
          <p className="empty">Could not load programs.</p>
        ) : visible.length === 0 ? (
          <p className="empty">
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
                    <td className="cell-strong">
                      <Link href={`/programs/${p.id}`}>{p.name}</Link>{" "}
                      {p.isNew ? <span className="pill">New</span> : null}
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
                          className={watchedIds.has(p.id) ? "btn-sm btn-on" : "btn-sm"}
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
        {programs.length > 0 || !error ? (
          <Pager
            page={page}
            pages={pages}
            summary={`Showing ${rangeStart}–${rangeEnd} of ${total}`}
            onPrev={() => void loadPage(page - 1, activeQuery, sort)}
            onNext={() => void loadPage(page + 1, activeQuery, sort)}
          />
        ) : null}
      </div>

      {error ? <p className="error-banner">{error}</p> : null}
    </>
  );
}
