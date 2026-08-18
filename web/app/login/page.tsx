"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";
import { Button, Input, Panel } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: form,
      });
      setToken(r.token);
      const me = await api<{ role: string }>("/api/auth/me", { token: r.token });
      router.push(
        me.role === "admin" ? "/admin" : me.role === "evaluator" ? "/evaluator" : "/dashboard",
      );
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-6 flex w-full max-w-sm flex-col items-center gap-2 text-center">
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
      <Panel title="Sign in" className="w-full max-w-sm p-0">
        <form onSubmit={submit} className="space-y-4 p-5">
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
          {err && <div className="rounded-lg border border-sell/30 bg-sell/10 px-3 py-2 text-sm text-sell">{err}</div>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Panel>
      <p className="mt-4 text-center text-[13px] text-muted">
        No account?{" "}
        <Link href="/register" className="text-acc hover:underline">
          Register your team
        </Link>
      </p>
    </div>
  );
}
