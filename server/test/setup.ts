process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://mercatus:mercatus@localhost:5432/mercatus_test";
process.env.NODE_ENV = "test";

export {};

const { query } = await import("../src/db.js");
const { migrate } = await import("../src/schema.js");

await migrate();
await query(
  `truncate teams, holdings, order_logs, submissions, request_logs, scoring,
            leaderboard_snapshot, live_prices, market_state, dataset_ticks, market_datasets
   restart identity cascade`,
);
