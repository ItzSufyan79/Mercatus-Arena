import { describe, it, expect, beforeAll } from "vitest";
import { query } from "../src/db.js";
import { migrate } from "../src/schema.js";
import { computeScores, setJudgeScores, adminMetrics } from "../src/scoring.js";

beforeAll(async () => {
  await migrate();
  await query(`delete from scoring`);
  await query(`delete from teams where email like 'score-%@test'`);
});

async function addTeam(name: string, pv: number) {
  const { rows } = await query(
    `insert into teams (team_name, role, email, cash_balance, total_portfolio_value, starting_capital)
     values ($1, 'team', $2, $3, $3, $3)
     returning team_id`,
    [name, `score-${name}@test`, pv],
  );
  return Number(rows[0].team_id);
}

describe("scoring", () => {
  it("computes pnl-rank scores with the 50/25/25 formula", async () => {
    const a = await addTeam("alpha", 150_000);
    const b = await addTeam("bravo", 100_000);
    const c = await addTeam("charlie", 50_000);

    await setJudgeScores(b, 80, 90);
    await setJudgeScores(c, 60, 70);

    const { rows } = await computeScores();
    const byTeam = Object.fromEntries(rows.map((r) => [r.team_id, r]));

    // pnl_score for rank 1 of 3 = 100*(1 - 0/3) = 100; final = 100*0.5 + 0 + 0 = 50
    expect(Number(byTeam[a].final_score)).toBe(50);
    // rank 2: pnl = 100*(1-1/3) = 66.67; final = 33.33 + 20 + 22.5 = 75.83
    expect(Number(byTeam[b].final_score)).toBeCloseTo(75.83, 1);
    // rank 3: pnl = 100*(1-2/3) = 33.33; final = 16.67 + 15 + 17.5 = 49.17
    expect(Number(byTeam[c].final_score)).toBeCloseTo(49.17, 1);

    expect(byTeam[a].pnl_rank).toBe(1);
  });

  it("exposes admin metrics", async () => {
    const m = await adminMetrics();
    expect(m).toHaveProperty("latency");
    expect(m).toHaveProperty("fills");
    expect(Array.isArray(m.teams)).toBe(true);
    expect(Array.isArray(m.live)).toBe(true);
  });
});
