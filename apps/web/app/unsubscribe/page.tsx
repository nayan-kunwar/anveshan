"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { ReactNode } from "react";
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
        <h1>Unsubscribe</h1>
        <p className="error">This unsubscribe link is incomplete.</p>
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
        <h1>Unsubscribed</h1>
        <p>You will no longer receive change notifications. Sign in to re-subscribe.</p>
      </>
    );
  }

  return (
    <>
      <h1>Unsubscribe</h1>
      <p>Stop all Anveshan change notification emails for this account?</p>
      <p>
        <button type="button" disabled={busy} onClick={() => void onConfirm()}>
          {busy ? "Working…" : "Yes, unsubscribe me"}
        </button>
      </p>
      {error ? <p className="error">{error}</p> : null}
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
