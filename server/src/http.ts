import type { Response } from "express";
import { config } from "./config.js";

export function serverError(res: Response, err: unknown): void {
  console.error("[mercatus] error:", err);
  if (config.isProduction) {
    res.status(500).json({ error: "INTERNAL" });
    return;
  }
  res
    .status(500)
    .json({ error: "INTERNAL", detail: err instanceof Error ? err.message : String(err) });
}
