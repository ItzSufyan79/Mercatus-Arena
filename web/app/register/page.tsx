"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";
import { Button, Input, Panel } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ team_name: "", email: "", password: "", registration_code: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 6) {
      setErr("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>("/api/auth/register", {
        method: "POST",
        body: {
          team_name: form.team_name,
          email: form.email,
          password: form.password,
          ...(form.registration_code ? { registration_code: form.registration_code } : {}),
        },
      });
      setToken(r.token);
      router.push("/dashboard");
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="grid h-12 w-12 place-items-center bg-acc font-mono text-lg font-black text-bg">
          M
        </span>
        <div className="mt-1 font-display text-xl font-bold tracking-tight text-ink">
          MERCATUS<span className="text-acc">.ARENA</span>
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-dim">
          TechVerse 2026 · algo trading evaluation
        </div>
      </div>
      <Panel title="Register team" className="w-full max-w-sm p-0">
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="rounded-lg border border-gold/25 bg-gold/10 px-3 py-2 text-[12px] leading-relaxed text-gold">
            Your API key is generated now but stays masked until the admin
            reveals it at launch.
          </div>
          <Input
            label="Team name"
            required
            value={form.team_name}
            onChange={(e) => setForm({ ...form, team_name: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="Password"
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <Input
            label="Registration code"
            required
            placeholder="Enter event code from your instructor"
            value={form.registration_code}
            onChange={(e) => setForm({ ...form, registration_code: e.target.value })}
          />
          {err && <div className="rounded-lg border border-sell/30 bg-sell/10 px-3 py-2 text-sm text-sell">{err}</div>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating team…" : "Create team"}
          </Button>
        </form>
      </Panel>
      <p className="mt-4 text-center text-[13px] text-muted">
        Already registered?{" "}
        <Link href="/login" className="text-acc hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
