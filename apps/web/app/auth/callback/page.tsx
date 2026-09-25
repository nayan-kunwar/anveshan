"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, verifyMagicLink } from "../../lib/api";
import AuthShell from "../../components/AuthShell";

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
      <AuthShell>
        <p className="auth-eyebrow">Authentication error</p>
        <h1 className="auth-title">Sign-in failed</h1>
        <p className="error auth-error">{error}</p>
        <p className="auth-note">Links expire after 15 minutes and work only once.</p>
        <Link href="/login">Back to sign in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <div className="auth-center" role="status">
        <div className="auth-spinner" aria-hidden="true" />
        <h1 className="auth-title">Signing you in…</h1>
      </div>
    </AuthShell>
  );
}

export default function CallbackPage(): ReactNode {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
