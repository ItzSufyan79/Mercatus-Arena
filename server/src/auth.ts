import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { query } from "./db.js";
import { config } from "./config.js";
import { randomBytes } from "node:crypto";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateApiKey(): string {
  return `sk_${randomBytes(24).toString("hex")}`;
}

export function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export interface TeamClaims {
  team_id: number;
  email: string;
  role: string;
  ver?: number;
}

export function signTeamToken(claims: TeamClaims): string {
  return jwt.sign({ ...claims, ver: claims.ver ?? 0 }, config.jwtSecret, {
    expiresIn: "24h",
  });
}

export function verifyToken(token: string): TeamClaims {
  return jwt.verify(token, config.jwtSecret) as TeamClaims;
}

export interface AuthedRequest extends Request {
  team?: TeamClaims;
}

export function requirePortal(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "MISSING_TOKEN" });
  }
  let claims: TeamClaims;
  try {
    claims = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
  query(
    `select team_id, is_frozen, token_version from teams where team_id = $1`,
    [claims.team_id],
  )
    .then(({ rows }) => {
      const team = rows[0];
      if (!team) return res.status(401).json({ error: "INVALID_TOKEN" });
      if (team.is_frozen) return res.status(403).json({ error: "TEAM_FROZEN" });
      if (team.token_version !== (claims.ver ?? 0)) {
        return res.status(401).json({ error: "TOKEN_REVOKED" });
      }
      req.team = claims;
      next();
    })
    .catch(next);
}

export async function revokeTeamTokens(teamId: number): Promise<void> {
  await query(`update teams set token_version = token_version + 1 where team_id = $1`, [
    teamId,
  ]);
}

export function requireRole(role: "admin" | "evaluator") {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.team) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (req.team.role !== role) {
      return res.status(403).json({ error: `${role.toUpperCase()}_ONLY` });
    }
    next();
  };
}

export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.team) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (req.team.role !== "admin") {
    return res.status(403).json({ error: "ADMIN_ONLY" });
  }
  next();
}

export function requireApiKey(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !key) {
    return res.status(401).json({ error: "MISSING_API_KEY" });
  }
  const team = query(
    `select team_id, email, role from teams where api_key = $1 and is_frozen = false`,
    [key],
  );
  team
    .then(({ rows }) => {
      if (!rows[0]) {
        return res.status(401).json({ error: "INVALID_API_KEY" });
      }
      req.team = {
        team_id: rows[0].team_id,
        email: rows[0].email,
        role: rows[0].role,
      };
      next();
    })
    .catch(next);
}
