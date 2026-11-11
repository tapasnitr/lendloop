"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const CATEGORIES = ["power tools", "hand tools", "garden", "kitchen", "camping", "cleaning", "other"];
type Tab = "browse" | "listings" | "requests" | "incoming" | "admin";

function errMsg(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0];
}

function ago(ts: number) {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

type Activity = { kind: string; status: "sent" | "failed"; at: number };
function ActivityLine({ items }: { items: Activity[] }) {
  if (!items.length) return null;
  return (
    <div className="muted small">
      {items.map((a, i) => (
        <span key={i} className={a.status === "failed" ? "bad" : ""}>
          {a.kind.startsWith("overdue") ? "Reminder" : "Notification"} {a.status} {ago(a.at)}
          {i < items.length - 1 ? " · " : ""}
        </span>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<Tab>("browse");

  useEffect(() => {
    ensure().catch(() => {});
  }, [ensure]);

  if (!me) return <p className="muted">Setting up your profile…</p>;

  const tabs: [Tab, string][] = [
    ["browse", "Browse"],
    ["listings", "My listings"],
    ["requests", "My requests"],
    ["incoming", "Incoming requests"],
  ];
  if (me.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <>
      <nav className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "browse" && <Browse />}
      {tab === "listings" && <MyListings />}
      {tab === "requests" && <MyRequests />}
      {tab === "incoming" && <Incoming />}
      {tab === "admin" && me.role === "admin" && <Admin />}
    </>
  );
}

function Browse() {
  const [category, setCategory] = useState("all");
  const tools = useQuery(api.tools.listAll, { category });
  const request = useMutation(api.loans.request);
  const remove = useMutation(api.tools.remove);
  const me = useQuery(api.users.me);
  const [open, setOpen] = useState<Id<"tools"> | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(toolId: Id<"tools">) {
    try {
      await request({ toolId, startDate: start, endDate: end });
      setOpen(null);
      setMsg("Request sent!");
    } catch (e) {
      setMsg(errMsg(e));
    }
  }

  return (
    <section>
      <div className="row">
        <h2>All tools</h2>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {msg && <p className="notice">{msg}</p>}
      {tools === undefined ? (
        <p className="muted">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="muted">No tools here yet.</p>
      ) : (
        <ul className="grid">
          {tools.map((t) => (
            <li key={t._id} className="card">
              <div className="row">
                <strong>{t.name}</strong>
                <span className={t.available ? "pill ok" : "pill off"}>{t.available ? "Available" : "On loan"}</span>
              </div>
              <span className="tag">{t.category}</span> <span className="tag">{t.condition}</span>
              <p className="small">{t.description}</p>
              <p className="muted small">
                {t.ownerName} {t.ownerTrusted && <span className="pill ok">Trusted Lender</span>}
              </p>
              {!t.isMine && (
                <>
                  {open === t._id ? (
                    <div className="row">
                      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                      <button className="btn primary" onClick={() => submit(t._id)}>
                        Send
                      </button>
                    </div>
                  ) : (
                    <button className="btn" onClick={() => setOpen(t._id)}>
                      Request to borrow
                    </button>
                  )}
                </>
              )}
              {me?.role === "admin" && !t.isMine && (
                <button
                  className="btn danger"
                  onClick={() => confirm("Remove this listing?") && remove({ toolId: t._id }).catch((e) => setMsg(errMsg(e)))}
                >
                  Remove (admin)
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyListings() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const remove = useMutation(api.tools.remove);
  const update = useMutation(api.tools.update);
  const blank = { name: "", category: "power tools", condition: "good", description: "" };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing) await update({ toolId: editing, ...form });
      else await create(form);
      setForm(blank);
      setEditing(null);
      setMsg("");
    } catch (err) {
      setMsg(errMsg(err));
    }
  }

  return (
    <section>
      <h2>{editing ? "Edit listing" : "List a tool"}</h2>
      <form className="form" onSubmit={save}>
        <input placeholder="Name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
          {["new", "good", "fair", "worn"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <textarea placeholder="Short description" value={form.description} maxLength={400} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        <button className="btn primary">{editing ? "Save changes" : "Add listing"}</button>
        {editing && (
          <button type="button" className="btn" onClick={() => { setEditing(null); setForm(blank); }}>
            Cancel
          </button>
        )}
      </form>
      {msg && <p className="notice">{msg}</p>}

      <h2>My listings</h2>
      <ul className="grid">
        {listings?.map((t) => (
          <li key={t._id} className="card">
            <div className="row">
              <strong>{t.name}</strong>
              <span className={t.available ? "pill ok" : "pill off"}>{t.available ? "Available" : "On loan"}</span>
            </div>
            <span className="tag">{t.category}</span> <span className="tag">{t.condition}</span>
            <p className="small">{t.description}</p>
            <div className="row">
              <button className="btn" onClick={() => { setEditing(t._id); setForm({ name: t.name, category: t.category, condition: t.condition, description: t.description }); }}>
                Edit
              </button>
              <button className="btn danger" onClick={() => confirm("Delete this listing?") && remove({ toolId: t._id }).catch((e) => setMsg(errMsg(e)))}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {listings?.length === 0 && <p className="muted">You haven&apos;t listed anything yet.</p>}
    </section>
  );
}

function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  return (
    <section>
      <h2>My requests</h2>
      {loans?.length === 0 && <p className="muted">You haven&apos;t requested anything yet.</p>}
      <ul className="list">
        {loans?.map((l) => (
          <li key={l._id} className="card">
            <div className="row">
              <strong>{l.toolName}</strong>
              <span className={`pill ${l.overdue ? "off" : l.status === "approved" ? "ok" : ""}`}>{l.overdue ? "overdue" : l.status}</span>
            </div>
            <p className="small">
              From {l.ownerName} · {l.startDate} → {l.endDate}
            </p>
            <ActivityLine items={l.activity} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Incoming() {
  const loans = useQuery(api.loans.incoming);
  const decide = useMutation(api.loans.decide);
  const returned = useMutation(api.loans.markReturned);
  const [msg, setMsg] = useState("");
  const run = (p: Promise<unknown>) => p.then(() => setMsg("")).catch((e) => setMsg(errMsg(e)));
  return (
    <section>
      <h2>Incoming requests</h2>
      {msg && <p className="notice">{msg}</p>}
      {loans?.length === 0 && <p className="muted">No requests on your tools yet.</p>}
      <ul className="list">
        {loans?.map((l) => (
          <li key={l._id} className="card">
            <div className="row">
              <strong>{l.toolName}</strong>
              <span className={`pill ${l.overdue ? "off" : l.status === "approved" ? "ok" : ""}`}>{l.overdue ? "overdue" : l.status}</span>
            </div>
            <p className="small">
              {l.borrowerName} · {l.startDate} → {l.endDate}
            </p>
            <ActivityLine items={l.activity} />
            {l.status === "requested" && (
              <div className="row">
                <button className="btn primary" onClick={() => run(decide({ loanId: l._id, approve: true }))}>Approve</button>
                <button className="btn" onClick={() => run(decide({ loanId: l._id, approve: false }))}>Decline</button>
              </div>
            )}
            {l.status === "approved" && (
              <button className="btn" onClick={() => run(returned({ loanId: l._id }))}>Mark returned</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Admin() {
  const loans = useQuery(api.loans.adminAll);
  const users = useQuery(api.admin.listUsers);
  const setTrusted = useMutation(api.admin.setTrusted);
  return (
    <section>
      <h2>Lenders</h2>
      <ul className="list">
        {users?.map((u) => (
          <li key={u._id} className="card row">
            <span>
              {u.name} <span className="muted small">({u.role})</span>
            </span>
            <button className="btn" onClick={() => setTrusted({ userId: u._id, trusted: !u.trusted })}>
              {u.trusted ? "Remove Trusted Lender" : "Mark Trusted Lender"}
            </button>
          </li>
        ))}
      </ul>
      <h2>All loans</h2>
      <ul className="list">
        {loans?.map((l) => (
          <li key={l._id} className="card">
            <div className="row">
              <strong>{l.toolName}</strong>
              <span className={`pill ${l.overdue ? "off" : ""}`}>{l.overdue ? "overdue" : l.status}</span>
            </div>
            <p className="small">
              {l.ownerName} → {l.borrowerName} · {l.startDate} → {l.endDate}
            </p>
            <ActivityLine items={l.activity} />
          </li>
        ))}
      </ul>
    </section>
  );
}
