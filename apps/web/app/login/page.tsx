"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ApiError, requestMagicLink } from "../lib/api";
import AuthShell from "../components/AuthShell";

interface SubmitEvent {
  preventDefault(): void;
}

export default function LoginPage(): ReactNode {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <p className="auth-eyebrow">Link sent</p>
        <h1 className="auth-title">Check your inbox</h1>
        <p className="auth-sub">
          A sign-in link is on its way to <strong>{email}</strong>. It expires in 15
          minutes.
        </p>
        <button type="button" className="auth-link-btn" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="auth-eyebrow">Welcome back</p>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-sub">
        Enter your email and we&apos;ll send a one-time sign-in link.
      </p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <div className="auth-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            maxLength={320}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </div>
        <button type="submit" className="auth-btn" disabled={busy}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
      </form>
      {error ? <p className="error auth-error">{error}</p> : null}
      <p className="auth-alt">
        New to Anveshan? Sign in — your account is created automatically on first sign-in.
      </p>
    </AuthShell>
  );
}
