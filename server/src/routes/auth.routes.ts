import { Router, type Request, type Response } from "express";
import {
  generateApiKey,
  hashPassword,
  maskApiKey,
  requirePortal,
  revokeTeamTokens,
  signTeamToken,
  verifyPassword,
  type AuthedRequest,
} from "../auth.js";
import { query } from "../db.js";
import { config } from "../config.js";
import { serverError } from "../http.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const authRoutes = Router();

authRoutes.post("/register", async (req, res) => {
  try {
    const { team_name, email, password, registration_code } = req.body ?? {};
    if (!team_name || !email || !password) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    if (typeof team_name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "INVALID_FIELDS" });
    }
    const name = team_name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (name.length < 2 || name.length > 64) {
      return res.status(400).json({ error: "INVALID_TEAM_NAME" });
    }
    if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
      return res.status(400).json({ error: "INVALID_EMAIL" });
    }
    if (password.length < config.minPasswordLength) {
      return res.status(400).json({ error: "WEAK_PASSWORD" });
    }
    if (
      config.registrationCode &&
      (typeof registration_code !== "string" ||
        registration_code.trim() !== config.registrationCode)
    ) {
      return res.status(403).json({ error: "INVALID_REGISTRATION_CODE" });
    }
    const exists = await query(
      `select team_id from teams where email = $1 or team_name = $2`,
      [cleanEmail, name],
    );
    if (exists.rows[0]) {
      return res.status(409).json({ error: "EMAIL_OR_NAME_TAKEN" });
    }
    const cfg = await query(`select start_capital from event_config where id = true`);
    const startCapital = Number(cfg.rows[0].start_capital);
    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();
    const { rows } = await query(
      `insert into teams (team_name, role, email, password_hash, api_key, cash_balance, starting_capital, total_portfolio_value)
       values ($1, 'team', $2, $3, $4, $5, $5, $5)
       returning team_id, team_name, role, email`,
      [name, cleanEmail, passwordHash, apiKey, startCapital],
    );
    const team = rows[0];
    const token = signTeamToken({
      team_id: team.team_id,
      email: team.email,
      role: team.role,
    });
    res.status(201).json({
      token,
      team: { ...team, api_key: maskApiKey(apiKey) },
      message: "Credentials are masked until the admin reveals them before launch.",
    });
  } catch (err) {
    serverError(res, err);
  }
});

authRoutes.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    const { rows } = await query(
      `select team_id, team_name, role, email, password_hash, api_key, is_frozen, token_version
       from teams where email = $1`,
      [email.trim().toLowerCase()],
    );
    const team = rows[0];
    if (!team || !(await verifyPassword(password, team.password_hash))) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    const token = signTeamToken({
      team_id: team.team_id,
      email: team.email,
      role: team.role,
      ver: team.token_version,
    });
    res.json({
      token,
      team: {
        team_id: team.team_id,
        team_name: team.team_name,
        role: team.role,
        email: team.email,
        is_frozen: team.is_frozen,
      },
    });
  } catch (err) {
    serverError(res, err);
  }
});

authRoutes.post("/logout", requirePortal, async (req: AuthedRequest, res: Response) => {
  try {
    await revokeTeamTokens(req.team!.team_id);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

authRoutes.post("/password", requirePortal, async (req: AuthedRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body ?? {};
    if (
      typeof current_password !== "string" ||
      typeof new_password !== "string"
    ) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    if (new_password.length < config.minPasswordLength) {
      return res.status(400).json({ error: "WEAK_PASSWORD" });
    }
    const { rows } = await query(
      `select password_hash from teams where team_id = $1`,
      [req.team!.team_id],
    );
    if (!(await verifyPassword(current_password, rows[0].password_hash))) {
      return res.status(401).json({ error: "INVALID_PASSWORD" });
    }
    await query(
      `update teams set password_hash = $1, token_version = token_version + 1 where team_id = $2`,
      [await hashPassword(new_password), req.team!.team_id],
    );
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

authRoutes.get("/me", requirePortal, async (req: AuthedRequest, res: Response) => {
  try {
    const cfg = await query(`select credentials_revealed from event_config where id = true`);
    const { rows } = await query(
      `select team_id, team_name, role, email, api_key, cash_balance,
              starting_capital, total_portfolio_value, is_frozen, created_at
       from teams where team_id = $1`,
      [req.team!.team_id],
    );
    const team = rows[0];
    const revealed = cfg.rows[0].credentials_revealed;
    res.json({
      ...team,
      api_key: revealed ? team.api_key : maskApiKey(team.api_key),
      credentials_revealed: revealed,
    });
  } catch (err) {
    serverError(res, err);
  }
});
