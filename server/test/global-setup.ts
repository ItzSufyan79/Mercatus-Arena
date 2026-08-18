import { execSync } from "node:child_process";

export default function setup() {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgres://mercatus:mercatus@localhost:5432/mercatus_test";
  try {
    execSync(
      `createdb mercatus_test 2>/dev/null; PGPASSWORD=mercatus psql -h localhost -U mercatus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mercatus_test'"`,
      { stdio: "ignore" },
    );
  } catch {
    // createdb may already exist; proceed
  }
  return () => {};
}
