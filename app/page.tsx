"use client";

import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Dashboard from "@/components/Dashboard";

function PublicTools() {
  const tools = useQuery(api.tools.listPublic);
  return (
    <section>
      <h2>Available right now</h2>
      {tools === undefined ? (
        <p className="muted">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="muted">Nothing listed yet. Be the first to lend something!</p>
      ) : (
        <ul className="grid">
          {tools.map((t) => (
            <li key={t.key} className="card">
              <strong>{t.name}</strong>
              <span className="tag">{t.category}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <header className="bar">
        <span className="logo">🔁 LendLoop</span>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </header>

      <SignedOut>
        <section className="hero">
          <h1>Borrow what you need. Lend what you don&apos;t.</h1>
          <p className="muted">A tool-lending board for your neighborhood.</p>
          <SignInButton mode="modal">
            <button className="btn primary">Sign in to lend or borrow</button>
          </SignInButton>
        </section>
        <PublicTools />
      </SignedOut>

      <SignedIn>
        <Dashboard />
      </SignedIn>
    </main>
  );
}
