"use client";

import { useEffect, useState } from "react";
import { api, STATUS } from "./api";

export function useStatus(intervalMs = 2000): STATUS | null {
  const [status, setStatus] = useState<STATUS | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<STATUS>("/api/market/status")
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);

  return status;
}
