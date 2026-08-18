import { describe, it, expect } from "vitest";
import { query } from "../src/db.js";
import { migrate } from "../src/schema.js";
import { generateSyntheticDataset } from "../src/generator.js";
import { EventEngine } from "../src/engine.js";

async function freshEngine(symbols: string[], minutes: number) {
  await query(
    `truncate live_prices, market_state, dataset_ticks, market_datasets
     restart identity cascade`,
  );
  await query(
    `update event_config set state = 'PRE_LAUNCH', paused = false,
            leaderboard_frozen = false, credentials_revealed = false,
            tick_count = 0, flash_shock = 0, replay_speed = 1,
            event_started_at = null, scheduled_end_at = null,
            leaderboard_freeze_at = null, api_freeze_at = null
     where id = true`,
  );
  await generateSyntheticDataset({
    symbols,
    durationMinutes: minutes,
    spacingMs: 1000,
    seed: 1,
  });
  const engine = new EventEngine();
  await engine.init();
  return engine;
}

describe("EventEngine", () => {
  it("advances replay time based on wall clock x replay speed", async () => {
    const engine = await freshEngine(["TST"], 60);
    expect(engine.getStatus().symbols).toContain("TST");
    expect(engine.getStatus().state).toBe("PRE_LAUNCH");

    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(`update event_config set replay_speed = 60 where id = true`);
    await engine.reloadConfig();

    await new Promise((r) => setTimeout(r, 150));
    await engine.tick();

    expect(engine.getStatus().state).toBe("ACTIVE_MARKET");
    expect(engine.price("TST")).toBeGreaterThan(0);
    const t = await query(`select tick_count from event_config where id = true`);
    expect(Number(t.rows[0].tick_count)).toBeGreaterThan(0);
  });

  it("freezes the leaderboard when blackout time passes", async () => {
    const engine = await freshEngine(["TST"], 60);
    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(
      `update event_config set leaderboard_freeze_at = now() - interval '1 second' where id = true`,
    );
    await engine.reloadConfig();
    await engine.tick();
    const cfg = await query(
      `select leaderboard_frozen from event_config where id = true`,
    );
    expect(cfg.rows[0].leaderboard_frozen).toBe(true);
  });

  it("concludes when the dataset end is reached", async () => {
    const engine = await freshEngine(["TST"], 1);
    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(`update event_config set replay_speed = 1000 where id = true`);
    await engine.reloadConfig();
    await new Promise((r) => setTimeout(r, 200));
    await engine.tick();
    expect(engine.getStatus().state).toBe("EVENT_CONCLUDED");
  });

  it("concludes once scheduled_end passes while API_FROZEN", async () => {
    const engine = await freshEngine(["TST"], 60);
    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(
      `update event_config set state = 'API_FROZEN',
              api_freeze_at = now() - interval '2 seconds',
              scheduled_end_at = now() - interval '1 second'
       where id = true`,
    );
    await engine.reloadConfig();

    await engine.tick();
    expect(engine.getStatus().state).toBe("EVENT_CONCLUDED");
  });

  it("stays API_FROZEN when scheduled_end has not passed", async () => {
    const engine = await freshEngine(["TST"], 60);
    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(
      `update event_config set state = 'API_FROZEN',
              api_freeze_at = now() - interval '2 seconds',
              scheduled_end_at = now() + interval '1 hour'
       where id = true`,
    );
    await engine.reloadConfig();

    await engine.tick();
    expect(engine.getStatus().state).toBe("API_FROZEN");
  });

  it("concludes a paused event once scheduled_end passes and freezes the leaderboard", async () => {
    const engine = await freshEngine(["TST"], 60);
    await engine.startEvent({
      startCapital: 100_000,
      eventMinutes: 10,
      blackoutMinutes: 1,
      apiFreezeMinutes: 1,
    });
    await query(
      `update event_config set paused = true,
              scheduled_end_at = now() - interval '1 second'
       where id = true`,
    );
    await engine.reloadConfig();

    await engine.tick();
    expect(engine.getStatus().state).toBe("EVENT_CONCLUDED");
    const cfg = await query(
      `select leaderboard_frozen from event_config where id = true`,
    );
    expect(cfg.rows[0].leaderboard_frozen).toBe(true);
  });
});

await migrate();
