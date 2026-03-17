"use client";

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const CardShell = ({
  eyebrow,
  title,
  body,
  statusTone = "text-accent",
}: {
  eyebrow: string;
  title: string;
  body: string;
  statusTone?: string;
}) => {
  return (
    <section
      aria-labelledby="auth-status-heading"
      className="garden-bed pattern-leaves overflow-hidden px-6 py-5 text-left"
    >
      <p className={`text-[0.7rem] font-semibold uppercase tracking-[0.14em] ${statusTone}`}>
        {eyebrow}
      </p>
      <h2
        id="auth-status-heading"
        className="font-display text-xl font-semibold text-foreground mt-2"
      >
        {title}
      </h2>
      <p className="text-sm leading-6 text-foreground-2 mt-2">{body}</p>
    </section>
  );
};

const AuthenticatedViewerState = () => {
  const viewer = useQuery(api.auth.viewer, {});

  if (viewer === undefined) {
    return (
      <CardShell
        eyebrow="Checking session"
        title="Convex is validating your session"
        body="Your Clerk session is signed in. Waiting for Convex to confirm the token and load your viewer details."
      />
    );
  }

  if (!viewer) {
    return (
      <CardShell
        eyebrow="Session mismatch"
        title="Clerk is signed in, but Convex does not see a viewer yet"
        body="Finish the Clerk-to-Convex dashboard setup, then refresh this page to re-run the smoke test."
        statusTone="text-serious"
      />
    );
  }

  const primaryIdentity = viewer.email ?? viewer.name ?? viewer.subject;

  return (
    <section
      aria-labelledby="auth-status-heading"
      className="garden-bed pattern-leaves overflow-hidden px-6 py-5 text-left"
    >
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
        Clerk to Convex
      </p>
      <h2
        id="auth-status-heading"
        className="font-display text-xl font-semibold text-foreground mt-2"
      >
        Convex sees you
      </h2>
      <p className="text-sm leading-6 text-foreground-2 mt-2">
        Signed in as <span className="font-semibold text-foreground">{primaryIdentity}</span>.
        The Convex viewer query resolved with your Clerk-backed identity.
      </p>
      <dl className="mt-4 grid gap-3 text-sm text-foreground-2 sm:grid-cols-2">
        <div>
          <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Subject
          </dt>
          <dd className="mt-1 break-all text-foreground">{viewer.subject}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Issuer
          </dt>
          <dd className="mt-1 break-all text-foreground">{viewer.issuer}</dd>
        </div>
      </dl>
    </section>
  );
};

export const HomeAuthStatusCard = () => {
  return (
    <div aria-live="polite">
      <AuthLoading>
        <CardShell
          eyebrow="Checking session"
          title="Looking for a Convex session"
          body="Clerk and Convex are comparing notes so we can show the right signed-in state."
        />
      </AuthLoading>

      <Unauthenticated>
        <CardShell
          eyebrow="Guest mode"
          title="You are browsing anonymously"
          body="Sign in from the header to test the Clerk-to-Convex handshake. The app stays fully public either way."
        />
      </Unauthenticated>

      <Authenticated>
        <AuthenticatedViewerState />
      </Authenticated>
    </div>
  );
};
