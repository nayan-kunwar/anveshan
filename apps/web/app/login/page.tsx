"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ApiError, requestMagicLink } from "../lib/api";

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
      <>
        <h1>Check your inbox</h1>
        <p>
          A sign-in link is on its way to <strong>{email}</strong>. It expires in 15
          minutes.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="small">Enter your email to receive a one-time sign-in link.</p>
      <form onSubmit={(event) => void onSubmit(event)}>
        <input
          type="email"
          required
          maxLength={320}
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
