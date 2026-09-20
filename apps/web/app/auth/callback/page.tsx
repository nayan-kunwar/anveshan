"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, verifyMagicLink } from "../../lib/api";

function CallbackInner(): ReactNode {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Missing sign-in token.");
      return;
    }
    verifyMagicLink(token)
      .then(() => {
        router.replace("/dashboard");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Sign-in failed");
      });
  }, [params, router]);

  if (error) {
    return (
      <div className="center">
        <h1>Sign-in failed</h1>
        <p className="error">{error}</p>
        <p className="small">Links expire after 15 minutes and work only once.</p>
      </div>
    );
  }
  return (
    <div className="center">
      <h1>Signing you in…</h1>
    </div>
  );
}

export default function CallbackPage(): ReactNode {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
