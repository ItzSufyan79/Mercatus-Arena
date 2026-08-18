import { query } from "./db.js";

export async function computeScores() {
  await query(
    `with ranked as (
       select t.team_id, t.total_portfolio_value,
              rank() over (order by t.total_portfolio_value desc) as rnk,
              count(*) over () as cnt
       from teams t where t.role = 'team'
     ),
     base as (
       select r.team_id, r.rnk,
              100 * (1 - ((r.rnk - 1)::numeric / nullif(r.cnt, 0))) as pnl_score,
              coalesce(s.code_quality_score, 0) as code,
              coalesce(s.strategy_report_score, 0) as report
       from ranked r
       left join scoring s on s.team_id = r.team_id
     )
     insert into scoring (team_id, pnl_rank, final_score, updated_at)
     select team_id, rnk,
            round((pnl_score * 0.5) + (code * 0.25) + (report * 0.25), 2),
            now()
     from base
     on conflict (team_id) do update
     set pnl_rank = excluded.pnl_rank,
         final_score = excluded.final_score,
         updated_at = now()`,
  );
  return query(
    `select team_id, pnl_rank, code_quality_score, strategy_report_score, final_score
     from scoring order by final_score desc nulls last`,
  );
}

export async function setJudgeScores(
  teamId: number,
  codeQuality: number,
  strategyReport: number,
) {
  return query(
    `insert into scoring (team_id, code_quality_score, strategy_report_score)
     values ($1, $2, $3)
     on conflict (team_id) do update
     set code_quality_score = excluded.code_quality_score,
         strategy_report_score = excluded.strategy_report_score,
         updated_at = now()`,
    [teamId, codeQuality, strategyReport],
  );
}

export async function adminMetrics() {
  const latency = await query(
    `select
       count(*) as requests,
       round(avg(latency_ms), 1) as avg_latency_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
       percentile_cont(0.99) within group (order by latency_ms) as p99_ms,
       count(*) filter (where status >= 400) as errors
     from request_logs`,
  );
  const fills = await query(
    `select team_id,
       count(*) filter (where status = 'SUCCESS') as filled,
       count(*) filter (where status = 'REJECTED') as rejected,
       count(*) filter (where reason = 'INSUFFICIENT_FUNDS') as insufficient_funds,
       round(avg(latency_ms) filter (where status = 'SUCCESS'), 1) as avg_trade_ms
     from order_logs
     group by team_id`,
  );
  const { rows: teamRows } = await query(
    `select team_id, team_name, email, is_frozen, cash_balance, total_portfolio_value,
            api_key, role
     from teams order by role desc, team_name`,
  );
  const teams = teamRows.map((t) => ({
    ...t,
    api_key: t.api_key ? mask(t.api_key) : null,
  }));
  const live = await query(`select * from live_prices order by symbol`);
  return { latency: latency.rows[0], fills: fills.rows, teams, live: live.rows };
}

export const mask = (k: string | null) =>
  k ? `${k.slice(0, 6)}...${k.slice(-4)}` : null;
