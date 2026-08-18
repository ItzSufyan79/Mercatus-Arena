"use client";

import { useEffect, useState } from "react";
import type { STATUS } from "@/lib/api";

interface Props {
  status: Partial<STATUS>;
}

interface Marker {
  label: string;
  time: number;
  color: string;
  reached: boolean;
}

function hms(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const str = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return neg ? `-${str}` : str;
}

function istLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export function EventProgressBar({ status }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const startMs = status.eventStartedAt
    ? new Date(status.eventStartedAt).getTime()
    : status.scheduledStartAt
      ? new Date(status.scheduledStartAt).getTime()
      : null;
  const endMs = status.scheduledEndAt ? new Date(status.scheduledEndAt).getTime() : null;
  const freezeMs = status.leaderboardFreezeAt ? new Date(status.leaderboardFreezeAt).getTime() : null;
  const apiFreezeMs = status.apiFreezeAt ? new Date(status.apiFreezeAt).getTime() : null;

  if (!startMs || !endMs) {
    if (status.state === "PRE_LAUNCH" && status.scheduledStartAt) {
      const schedStart = new Date(status.scheduledStartAt).getTime();
      const diff = schedStart - now;
      return (
        <div className="rounded-lg border border-line bg-panel px-4 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">
              Event starts at {istLabel(schedStart)} IST
            </span>
            <span className="num text-xs font-bold text-gold">T-{hms(diff)}</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const duration = endMs - startMs;
  const elapsed = Math.max(0, now - startMs);
  const progress = Math.min(100, (elapsed / duration) * 100);
  const remaining = Math.max(0, endMs - now);
  const isConcluded = status.state === "EVENT_CONCLUDED";

  const markers: Marker[] = [
    {
      label: "Start",
      time: startMs,
      color: "#2ecc71",
      reached: now >= startMs,
    },
    ...(status.credentialsRevealed
      ? [
          {
            label: "API Reveal",
            time: status.eventStartedAt
              ? new Date(status.eventStartedAt).getTime()
              : startMs,
            color: "#3b82f6",
            reached: status.credentialsRevealed,
          },
        ]
      : []),
    ...(freezeMs
      ? [
          {
            label: "Leaderboard Freeze",
            time: freezeMs,
            color: "#f0b90b",
            reached: now >= freezeMs,
          },
        ]
      : []),
    ...(apiFreezeMs
      ? [
          {
            label: "API Freeze",
            time: apiFreezeMs,
            color: "#f97316",
            reached: now >= apiFreezeMs,
          },
        ]
      : []),
    {
      label: "End",
      time: endMs,
      color: "#f0514c",
      reached: now >= endMs,
    },
  ];

  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-dim">
          {isConcluded ? "Event Complete" : "Event Progress"}
        </span>
        <span className="num text-muted">
          {hms(elapsed)} / {hms(duration)}
          <span className="ml-2 text-dim">({progress.toFixed(1)}%)</span>
        </span>
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background: isConcluded
              ? "linear-gradient(90deg, #2ecc71, #f0b90b, #f0514c)"
              : "linear-gradient(90deg, #2ecc71, #f0b90b)",
          }}
        />
      </div>

      <div className="relative mt-1 h-5">
        {markers.map((m) => {
          const pct = ((m.time - startMs) / duration) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div
              key={m.label}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${pct}%` }}
            >
              <div
                className={`h-2.5 w-0.5 rounded-full ${m.reached ? "opacity-100" : "opacity-30"}`}
                style={{ backgroundColor: m.color }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {markers.map((m) => (
          <div key={m.label} className="flex items-center gap-1.5 text-[10px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${m.reached ? "opacity-100" : "opacity-30"}`}
              style={{ backgroundColor: m.color }}
            />
            <span className={m.reached ? "text-ink" : "text-dim"}>{m.label}</span>
            <span className="num text-dim">{istLabel(m.time)}</span>
          </div>
        ))}
      </div>

      <div className="mt-1.5 text-right text-[10px] text-dim">
        {isConcluded ? (
          "Event concluded"
        ) : (
          <>
            <span className="num">
              {remaining > 0 ? `${hms(remaining)} remaining` : "Ending..."}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
