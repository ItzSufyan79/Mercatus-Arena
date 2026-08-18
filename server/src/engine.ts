import { query } from "./db.js";
import { broadcast, setHelloProvider } from "./ws.js";
import { config, type EventState } from "./config.js";

interface EventConfigRow {
  state: EventState;
  paused: boolean;
  start_capital: string;
  replay_speed: string;
  noise_sigma: string;
  volatility_multiplier: string;
  flash_shock: string;
  credentials_revealed: boolean;
  leaderboard_frozen: boolean;
  event_started_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  leaderboard_freeze_at: string | null;
  api_freeze_at: string | null;
  tick_count: string;
}

interface DatasetRow {
  dataset_id: number;
  name: string;
  row_count: number;
  symbol_list: string[];
  start_t: number;
  end_t: number;
}

export interface LiveTick {
  symbol: string;
  price: number;
  prev: number;
}

function gaussian(): number {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export class EventEngine {
  private cfg!: EventConfigRow;
  private dataset: DatasetRow | null = null;
  private lastT = 0;
  private startWallMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prices = new Map<string, number>();
  private maxRowsPerTick = Number(process.env.MAX_ROWS_PER_TICK ?? 5000);

  async init() {
    const res = await query(`select * from event_config where id = true`);
    this.cfg = res.rows[0] as EventConfigRow;

    const ds = await query(
      `select * from market_datasets where is_active = true limit 1`,
    );
    if (ds.rows[0]) {
      this.dataset = ds.rows[0] as DatasetRow;
      const ms = await query(
        `select last_t from market_state where dataset_id = $1`,
        [this.dataset.dataset_id],
      );
      this.lastT = Number(ms.rows[0]?.last_t ?? 0);
    }

    const lp = await query(`select symbol, price from live_prices`);
    for (const r of lp.rows) {
      this.prices.set(r.symbol, Number(r.price));
    }

    setHelloProvider(() => this.getStatus());
    this.startTimer();
  }

  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick();
    }, config.tickIntervalMs);
    this.timer.unref?.();
  }

  getStatus() {
    return {
      state: this.cfg.state,
      paused: this.cfg.paused,
      credentialsRevealed: this.cfg.credentials_revealed,
      leaderboardFrozen: this.cfg.leaderboard_frozen,
      tickCount: Number(this.cfg.tick_count),
      startCapital: Number(this.cfg.start_capital),
      replaySpeed: Number(this.cfg.replay_speed),
      volatility: Number(this.cfg.volatility_multiplier),
      symbols: this.dataset?.symbol_list ?? [],
      prices: Object.fromEntries(this.prices),
      datasetName: this.dataset?.name ?? null,
      eventStartedAt: this.cfg.event_started_at,
      scheduledStartAt: this.cfg.scheduled_start_at,
      scheduledEndAt: this.cfg.scheduled_end_at,
      apiFreezeAt: this.cfg.api_freeze_at,
      leaderboardFreezeAt: this.cfg.leaderboard_freeze_at,
    };
  }

  async tick() {
    const now = Date.now();

    if (
      this.cfg.state === "PRE_LAUNCH" &&
      this.cfg.scheduled_start_at &&
      now >= Date.parse(this.cfg.scheduled_start_at)
    ) {
      await this.startEvent({
        startCapital: Number(this.cfg.start_capital),
        eventMinutes:
          (Date.parse(this.cfg.scheduled_end_at ?? this.cfg.scheduled_start_at) -
            Date.parse(this.cfg.scheduled_start_at)) /
          60_000,
        blackoutMinutes:
          this.cfg.leaderboard_freeze_at && this.cfg.scheduled_end_at
            ? (Date.parse(this.cfg.scheduled_end_at) -
                Date.parse(this.cfg.leaderboard_freeze_at)) /
              60_000
            : 20,
        apiFreezeMinutes:
          this.cfg.api_freeze_at && this.cfg.scheduled_end_at
            ? (Date.parse(this.cfg.scheduled_end_at) -
                Date.parse(this.cfg.api_freeze_at)) /
              60_000
            : 15,
      });
      return;
    }

    if (
      this.cfg.leaderboard_freeze_at &&
      now >= Date.parse(this.cfg.leaderboard_freeze_at) &&
      !this.cfg.leaderboard_frozen
    ) {
      await this.freezeLeaderboard();
    }
    if (
      this.cfg.scheduled_end_at &&
      now >= Date.parse(this.cfg.scheduled_end_at) &&
      this.cfg.state !== "EVENT_CONCLUDED"
    ) {
      return this.conclude();
    }
    if (this.cfg.paused) return;
    if (this.cfg.state !== "ACTIVE_MARKET") return;

    if (this.cfg.api_freeze_at && now >= Date.parse(this.cfg.api_freeze_at)) {
      await this.setLocalState("API_FROZEN");
    }

    if (!this.dataset) return;

    const elapsedMs = (now - this.startWallMs) * Number(this.cfg.replay_speed);
    const targetT = Math.floor(
      this.dataset.start_t + Math.max(0, elapsedMs),
    );
    if (targetT <= this.lastT) return;

    const rows = await query(
      `select t, symbol, price from dataset_ticks
       where dataset_id = $1 and t > $2 and t <= $3
       order by t limit $4`,
      [this.dataset.dataset_id, this.lastT, targetT, this.maxRowsPerTick],
    );

    const sigma =
      Number(this.cfg.noise_sigma) * Number(this.cfg.volatility_multiplier);
    let flash = Number(this.cfg.flash_shock);

    for (const r of rows.rows) {
      const base = Number(r.price);
      const noise = base * (1 + gaussian() * sigma);
      this.prices.set(r.symbol, round(noise * (1 + flash)));
    }

    const caughtUp = rows.rows.length < this.maxRowsPerTick;
    this.lastT = Math.max(this.lastT, targetT);

    if (rows.rows.length > 0) {
      const symbols = [...this.prices.keys()];
      const prices = symbols.map((s) => this.prices.get(s)!);
      await query(
        `insert into live_prices (symbol, price, prev_price, updated_at)
         select s, p, coalesce(lp.price, 0), now()
         from unnest($1::text[], $2::numeric[]) as x(s, p)
         left join live_prices lp on lp.symbol = x.s
         on conflict (symbol) do update
         set price = excluded.price, prev_price = live_prices.price,
             updated_at = now()`,
        [symbols, prices],
      );
      await query(
        `update market_state set last_t = $1, updated_at = now()
         where dataset_id = $2`,
        [this.lastT, this.dataset.dataset_id],
      );
      await query(
        `update event_config set tick_count = tick_count + $1, flash_shock = $2
         where id = true`,
        [rows.rows.length, round(flash * 0.8, 6)],
      );
      this.cfg.tick_count = String(
        Number(this.cfg.tick_count) + rows.rows.length,
      );
      this.cfg.flash_shock = String(round(flash * 0.8, 6));

      const batch: LiveTick[] = this.dataset.symbol_list.map((symbol) => {
        const price = this.prices.get(symbol);
        return { symbol, price: price ?? 0, prev: 0 };
      });
      broadcast({
        type: "tick",
        t: this.lastT,
        ts: Date.now(),
        prices: batch,
      });
    }

    if (caughtUp && targetT >= this.dataset.end_t) {
      await this.conclude();
    }
  }

  async conclude() {
    await this.freezeLeaderboard();
    await this.setLocalState("EVENT_CONCLUDED");
  }

  private async setLocalState(state: EventState) {
    this.cfg.state = state;
    await query(`update event_config set state = $1 where id = true`, [state]);
    broadcast({ type: "state", state });
  }

  async startEvent(opts: {
    startCapital: number;
    eventMinutes: number;
    blackoutMinutes: number;
    apiFreezeMinutes: number;
  }) {
    const now = new Date();
    const end = new Date(now.getTime() + opts.eventMinutes * 60_000);
    const freezeAt = new Date(
      now.getTime() + (opts.eventMinutes - opts.blackoutMinutes) * 60_000,
    );
    const apiFreezeAt = new Date(
      now.getTime() + (opts.eventMinutes - opts.apiFreezeMinutes) * 60_000,
    );

    if (this.dataset) {
      await query(`update market_state set last_t = 0 where dataset_id = $1`, [
        this.dataset.dataset_id,
      ]);
      this.lastT = 0;
    }
    await query(
      `update event_config set
         state = 'ACTIVE_MARKET', paused = false, start_capital = $1,
         event_started_at = $2, scheduled_end_at = $3,
         leaderboard_freeze_at = $4, api_freeze_at = $5,
         leaderboard_frozen = false, tick_count = 0, flash_shock = 0
       where id = true`,
      [opts.startCapital, now, end, freezeAt, apiFreezeAt],
    );
    await query(
      `update teams set cash_balance = $1, starting_capital = $1, total_portfolio_value = $1
       where role = 'team'`,
      [opts.startCapital],
    );
    await query(
      `truncate holdings, order_logs, request_logs, leaderboard_snapshot, scoring`,
    );

    await this.reloadConfig();
    this.startWallMs = Date.now();
    broadcast({
      type: "state",
      state: "ACTIVE_MARKET",
      eventStartedAt: now.toISOString(),
    });
  }

  async setSchedule(startAt: Date, endAt: Date) {
    const leaderboardFreezeAt = new Date(endAt.getTime() - 20 * 60_000);
    const apiFreezeAt = new Date(endAt.getTime() - 15 * 60_000);

    await query(
      `update event_config set
         state = 'PRE_LAUNCH', paused = false,
         scheduled_start_at = $1, scheduled_end_at = $2,
         leaderboard_freeze_at = $3, api_freeze_at = $4,
         leaderboard_frozen = false, tick_count = 0, flash_shock = 0,
         event_started_at = null, credentials_revealed = false
       where id = true`,
      [startAt, endAt, leaderboardFreezeAt, apiFreezeAt],
    );

    if (this.dataset) {
      await query(`update market_state set last_t = 0 where dataset_id = $1`, [
        this.dataset.dataset_id,
      ]);
      this.lastT = 0;
    }
    await query(
      `truncate holdings, order_logs, request_logs, leaderboard_snapshot, scoring`,
    );
    await query(
      `update teams set cash_balance = starting_capital, total_portfolio_value = starting_capital
       where role = 'team'`,
    );

    await this.reloadConfig();
    broadcast({
      type: "schedule",
      scheduledStartAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
      leaderboardFreezeAt: leaderboardFreezeAt.toISOString(),
      apiFreezeAt: apiFreezeAt.toISOString(),
    });
    broadcast({ type: "state", state: "PRE_LAUNCH" });
  }

  async clearSchedule() {
    await query(
      `update event_config set
         scheduled_start_at = null, scheduled_end_at = null,
         leaderboard_freeze_at = null, api_freeze_at = null
       where id = true`,
    );
    await this.reloadConfig();
    broadcast({ type: "schedule", scheduledStartAt: null, scheduledEndAt: null });
  }

  async reloadConfig() {
    const wasRunning =
      this.cfg?.state === "ACTIVE_MARKET" && !this.cfg?.paused;
    const targetT =
      this.dataset && wasRunning
        ? this.dataset.start_t +
          (Date.now() - this.startWallMs) * Number(this.cfg.replay_speed)
        : null;
    const res = await query(`select * from event_config where id = true`);
    this.cfg = res.rows[0] as EventConfigRow;
    const ratio = Number(this.cfg.replay_speed);
    this.startWallMs =
      targetT !== null && this.dataset && ratio > 0
        ? Date.now() - (targetT - this.dataset.start_t) / ratio
        : Date.now();
  }

  async reloadDataset() {
    await this.reloadConfig();
    const ds = await query(
      `select * from market_datasets where is_active = true limit 1`,
    );
    this.dataset = ds.rows[0] ? (ds.rows[0] as DatasetRow) : null;
    this.lastT = 0;
    if (this.dataset) {
      const ms = await query(
        `select last_t from market_state where dataset_id = $1`,
        [this.dataset.dataset_id],
      );
      this.lastT = Number(ms.rows[0]?.last_t ?? 0);
    }
    const lp = await query(`select symbol, price from live_prices`);
    this.prices.clear();
    for (const r of lp.rows) {
      this.prices.set(r.symbol, Number(r.price));
    }
    this.startWallMs = Date.now();
    broadcast({ type: "dataset_reloaded" });
  }

  async pause() {
    this.cfg.paused = true;
    await query(`update event_config set paused = true where id = true`);
    broadcast({ type: "state", state: this.cfg.state, paused: true });
  }

  async resume() {
    this.cfg.paused = false;
    this.startWallMs = Date.now();
    await query(`update event_config set paused = false where id = true`);
    broadcast({ type: "state", state: this.cfg.state, paused: false });
  }

  async setVolatility(multiplier: number) {
    this.cfg.volatility_multiplier = String(multiplier);
    await query(
      `update event_config set volatility_multiplier = $1 where id = true`,
      [multiplier],
    );
    broadcast({ type: "volatility", multiplier });
  }

  async triggerFlashCrash(shock: number) {
    this.cfg.flash_shock = String(shock);
    await query(`update event_config set flash_shock = $1 where id = true`, [
      shock,
    ]);
    broadcast({ type: "flash", shock });
  }

  async revealCredentials() {
    this.cfg.credentials_revealed = true;
    await query(
      `update event_config set credentials_revealed = true where id = true`,
    );
    broadcast({ type: "credentials_revealed" });
  }

  async freezeLeaderboard() {
    await query(
      `insert into leaderboard_snapshot (rank, team_id, team_name, total_portfolio_value)
       select rank() over (order by total_portfolio_value desc), team_id, team_name, total_portfolio_value
       from teams where role = 'team'`,
    );
    this.cfg.leaderboard_frozen = true;
    await query(
      `update event_config set leaderboard_frozen = true where id = true`,
    );
    broadcast({ type: "leaderboard_frozen" });
  }

  price(symbol: string): number | null {
    return this.prices.get(symbol) ?? null;
  }
}

export const engine = new EventEngine();
