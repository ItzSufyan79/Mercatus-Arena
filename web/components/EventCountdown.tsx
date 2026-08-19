"use client";

import { useEffect, useState } from "react";

interface Props {
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  state: string;
}

export function EventCountdown({ scheduledStartAt, scheduledEndAt, state }: Props) {
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<"idle" | "start" | "end">("idle");
  const [count, setCount] = useState(0);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    if (state === "EVENT_CONCLUDED") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    const startMs = scheduledStartAt ? new Date(scheduledStartAt).getTime() : null;
    const endMs = scheduledEndAt ? new Date(scheduledEndAt).getTime() : null;

    const startDiff = startMs ? startMs - now : Infinity;
    const endDiff = endMs ? endMs - now : Infinity;

    if (state === "PRE_LAUNCH" && startMs && startDiff > 0 && startDiff <= 5000) {
      const c = Math.ceil(startDiff / 1000);
      setPhase("start");
      setCount(c);
      setShowLabel(false);
    } else if (
      (state === "ACTIVE_MARKET" || state === "API_FROZEN") &&
      endMs &&
      endDiff > 0 &&
      endDiff <= 5000
    ) {
      const c = Math.ceil(endDiff / 1000);
      setPhase("end");
      setCount(c);
      setShowLabel(false);
    } else if (startMs && startDiff <= 0 && startDiff > -2000 && state === "PRE_LAUNCH") {
      setPhase("start");
      setCount(0);
      setShowLabel(true);
    } else if (endMs && endDiff <= 0 && endDiff > -2000 && state !== "EVENT_CONCLUDED") {
      setPhase("end");
      setCount(0);
      setShowLabel(true);
    } else {
      setPhase("idle");
    }
  }, [now, scheduledStartAt, scheduledEndAt, state]);

  if (phase === "idle") return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-center">
        {showLabel ? (
          <div className="animate-[countdownLabel_1.5s_ease-out]">
            <div
              className={`text-6xl font-black tracking-tight ${
                phase === "start" ? "text-buy" : "text-sell"
              }`}
              style={{ textShadow: `0 0 60px ${phase === "start" ? "#2ecc71" : "#f0514c"}` }}
            >
              {phase === "start" ? "MARKET OPEN" : "MARKET CLOSED"}
            </div>
          </div>
        ) : (
          <div key={`${phase}-${count}`} className="animate-[countdownPulse_0.9s_ease-out]">
            <div
              className={`text-[120px] font-black leading-none ${
                phase === "start" ? "text-buy" : "text-sell"
              }`}
              style={{
                textShadow: `0 0 80px ${phase === "start" ? "#2ecc7180" : "#f0514c80"}`,
              }}
            >
              {count}
            </div>
            <div className="mt-2 text-sm font-semibold uppercase tracking-[0.3em] text-dim">
              {phase === "start" ? "getting ready..." : "wrapping up..."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
