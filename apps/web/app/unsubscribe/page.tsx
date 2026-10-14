"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";
import PublicNav from "../components/PublicNav";
import { ApiError, unsubscribe } from "../lib/api";

function UnsubscribeInner(): ReactNode {
  const params = useSearchParams();
  const userIdParam = params.get("user");
  const tokenParam = params.get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (userIdParam === null || tokenParam === null) {
    return (
      <>
        <PublicNav />
        <div className="center">
          <div className="card">
            <h1>Unsubscribe</h1>
            <p className="error-banner">This unsubscribe link is incomplete.</p>
          </div>
        </div>
      </>
    );
  }
  const userId: string = userIdParam;
  const token: string = tokenParam;

  async function onConfirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await unsubscribe(userId, token);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unsubscribe failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <PublicNav />
        <div className="center">
          <div className="card">
            <h1>Unsubscribed</h1>
            <p className="desc">
              You will no longer receive change notifications. Sign in to re-subscribe.
            </p>
            <Link href="/login" className="card-link">
              Sign in →
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PublicNav />
      <div className="center">
        <div className="card">
          <h1>Unsubscribe</h1>
          <p className="desc">
            Stop all Anveshan change notification emails for this account?
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "Working…" : "Yes, unsubscribe me"}
          </button>
          {error ? <p className="error-banner">{error}</p> : null}
        </div>
      </div>
    </>
  );
}

export default function UnsubscribePage(): ReactNode {
  return (
    <Suspense>
      <UnsubscribeInner />
    </Suspense>
  );
}
