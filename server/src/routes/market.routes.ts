import { Router } from "express";
import { query } from "../db.js";
import { serverError } from "../http.js";
import { engine } from "../engine.js";

export const marketRoutes = Router();

marketRoutes.get("/status", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  void engine.tick();
  res.json(engine.getStatus());
});

marketRoutes.get("/snapshot", async (_req, res) => {
  try {
    const { rows } = await query(
      `select symbol, price, prev_price, updated_at from live_prices order by symbol`,
    );
    res.setHeader("Cache-Control", "public, max-age=1, s-maxage=1");
    res.json({
      prices: Object.fromEntries(rows.map((r) => [r.symbol, Number(r.price)])),
      updatedAt: rows[0]?.updated_at ?? null,
    });
  } catch (err) {
    serverError(res, err);
  }
});

marketRoutes.get("/leaderboard", async (_req, res) => {
  try {
    const cfg = await query(
      `select leaderboard_frozen from event_config where id = true`,
    );
    const frozen = cfg.rows[0].leaderboard_frozen;
    if (frozen) {
      const { rows } = await query(
        `select rank, team_id, team_name, total_portfolio_value
         from leaderboard_snapshot
         where captured_at = (select max(captured_at) from leaderboard_snapshot)
         order by rank`,
      );
      return res.json({ frozen: true, teams: rows });
    }
    const { rows } = await query(
      `select team_id, team_name, total_portfolio_value,
              rank() over (order by total_portfolio_value desc) as rank
       from teams where role = 'team'
       order by rank`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ frozen: false, teams: rows });
  } catch (err) {
    serverError(res, err);
  }
});

marketRoutes.get("/symbols", (_req, res) => {
  res.json({ symbols: engine.getStatus().symbols });
});
