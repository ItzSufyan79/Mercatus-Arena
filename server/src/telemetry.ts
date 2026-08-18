import type { NextFunction, Request, Response } from "express";
import { query } from "./db.js";

declare module "express-serve-static-core" {
  interface Request {
    startAt?: [number, number];
  }
}

export function telemetryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const start = process.hrtime();
  res.on("finish", () => {
    const [sec, nsec] = process.hrtime(start);
    const latencyMs = Math.round(sec * 1000 + nsec / 1e6);
    const teamId =
      (req as any).team?.team_id ??
      (req as any).user?.team_id ??
      null;
    if (teamId === null) return;
    void query(
      `insert into request_logs (team_id, method, path, status, latency_ms)
       values ($1, $2, $3, $4, $5)`,
      [teamId, req.method, req.path, res.statusCode, latencyMs],
    );
  });
  next();
}
