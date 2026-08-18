import { query } from "./db.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export async function generateSyntheticDataset(opts: {
  name?: string;
  symbols?: string[];
  durationMinutes?: number;
  spacingMs?: number;
  basePrices?: Record<string, number>;
  seed?: number;
}): Promise<{ datasetId: number; rows: number }> {
  const symbols = opts.symbols ?? ["AAPL", "MSFT", "GOOG", "TSLA", "NVDA"];
  const durationMinutes = opts.durationMinutes ?? 180;
  const spacingMs = opts.spacingMs ?? 1000;
  const basePrices =
    opts.basePrices ??
    Object.fromEntries(symbols.map((s, i) => [s, 100 + i * 37]));
  const rng = mulberry32(opts.seed ?? 42);
  const name = opts.name ?? `synthetic_${symbols.join("_")}_${durationMinutes}m`;

  const total = Math.floor((durationMinutes * 60_000) / spacingMs);
  const { rows } = await query(
    `insert into market_datasets (name, row_count, symbol_list, start_t, end_t, is_active)
     values ($1, $2, $3, 0, $4, true)
     returning dataset_id`,
    [name, total * symbols.length, symbols, total * spacingMs],
  );
  const datasetId = Number(rows[0].dataset_id);
  await query(
    `update market_datasets set is_active = false where dataset_id <> $1`,
    [datasetId],
  );

  const drift = 0.00002;
  const vol = 0.0015;
  const priceWalk = new Map<string, number>();
  for (const s of symbols) priceWalk.set(s, basePrices[s]);

  const BATCH = Math.max(1, Math.floor(60_000 / (symbols.length * 6)));
  let rowSeq = 0;
  for (let start = 0; start < total; start += BATCH) {
    const end = Math.min(start + BATCH, total);
    const vals: unknown[] = [];
    for (let seq = start + 1; seq <= end; seq++) {
      const t = seq * spacingMs;
      for (const symbol of symbols) {
        rowSeq++;
        const prev = priceWalk.get(symbol)!;
        const next = prev * (1 + drift + (rng() - 0.5) * 2 * vol);
        priceWalk.set(symbol, next);
        vals.push(datasetId, rowSeq, t, symbol, round(next), 100 + Math.floor(rng() * 900));
      }
    }
    const cols = 6;
    const rowsInChunk = vals.length / cols;
    const placeholders = Array.from(
      { length: rowsInChunk },
      (_, i) =>
        `(${Array.from(
          { length: cols },
          (_, j) => `$${i * cols + j + 1}`,
        ).join(",")})`,
    ).join(",");
    await query(
      `insert into dataset_ticks (dataset_id, seq, t, symbol, price, volume)
       values ${placeholders}`,
      vals,
    );
  }

  await query(`truncate live_prices, market_state`);
  await query(`insert into market_state (dataset_id, last_t) values ($1, 0)`, [
    datasetId,
  ]);
  const { rows: firstTicks } = await query(
    `select distinct on (symbol) symbol, price from dataset_ticks
     where dataset_id = $1 order by symbol, seq`,
    [datasetId],
  );
  for (const r of firstTicks) {
    await query(
      `insert into live_prices (symbol, price, prev_price) values ($1, $2, $2)`,
      [r.symbol, r.price],
    );
  }

  return { datasetId, rows: total * symbols.length };
}
