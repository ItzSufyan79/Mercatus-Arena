import { Router } from "express";
import { requirePortal, requireRole, type AuthedRequest } from "../auth.js";
import { query } from "../db.js";
import { adminMetrics, computeScores, setJudgeScores } from "../scoring.js";
import { mask } from "../scoring.js";

export const evaluatorRoutes = Router();
const evaluatorOnly = [requirePortal, requireRole("evaluator")];

evaluatorRoutes.get("/teams", ...evaluatorOnly, async (_req, res) => {
  const { rows } = await query(
    `select team_id, team_name, email, is_frozen, cash_balance,
            total_portfolio_value, api_key, created_at
     from teams where role = 'team' order by total_portfolio_value desc`,
  );
  res.json({
    teams: rows.map((t) => ({ ...t, api_key: mask(t.api_key) })),
  });
});

evaluatorRoutes.get("/teams/:id/audit", ...evaluatorOnly, async (req, res) => {
  const id = Number(req.params.id);
  const team = await query(
    `select team_id, team_name, cash_balance, total_portfolio_value, starting_capital
     from teams where team_id = $1`,
    [id],
  );
  if (!team.rows[0]) return res.status(404).json({ error: "TEAM_NOT_FOUND" });
  const trades = await query(
    `select order_id, action, symbol, quantity, price_executed, price_requested,
            status, reason, latency_ms, timestamp_ms
     from order_logs where team_id = $1 order by order_id desc limit 1000`,
    [id],
  );
  const reqLogs = await query(
    `select method, path, status, latency_ms, created_at
     from request_logs where team_id = $1 order by id desc limit 1000`,
    [id],
  );
  res.json({ team: team.rows[0], trades: trades.rows, requests: reqLogs.rows });
});

evaluatorRoutes.get("/teams/:id/submission", ...evaluatorOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query(
    `select pdf_storage_url, pdf_name, code_repository_link, submitted_at, updated_at
     from submissions where team_id = $1`,
    [id],
  );
  res.json(rows[0] ?? null);
});

evaluatorRoutes.post("/scoring", ...evaluatorOnly, async (req, res) => {
  const { team_id, code_quality, strategy_report } = req.body ?? {};
  if (!team_id || !Number.isFinite(Number(code_quality)) || !Number.isFinite(Number(strategy_report))) {
    return res.status(400).json({ error: "INVALID_SCORING_INPUT" });
  }
  await setJudgeScores(Number(team_id), Number(code_quality), Number(strategy_report));
  res.json({ ok: true });
});

evaluatorRoutes.post("/scoring/compute", ...evaluatorOnly, async (_req, res) => {
  const scores = await computeScores();
  res.json({ scores: scores.rows });
});

evaluatorRoutes.get("/scoring", ...evaluatorOnly, async (_req, res) => {
  const { rows } = await query(
    `select s.team_id, t.team_name, s.pnl_rank, s.code_quality_score,
            s.strategy_report_score, s.final_score
     from scoring s join teams t on t.team_id = s.team_id
     order by s.final_score desc nulls last`,
  );
  res.json({ scores: rows });
});

evaluatorRoutes.get("/metrics", ...evaluatorOnly, async (_req, res) => {
  res.json(await adminMetrics());
});
