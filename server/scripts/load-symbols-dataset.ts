import { readFileSync } from "node:fs";
import { generateSyntheticDataset } from "../src/generator.js";

const BASE_PRICES: Record<string, number> = {
  AAPL: 228, MSFT: 445, GOOG: 181, GOOGL: 181, AMZN: 214, NVDA: 140,
  META: 590, AMD: 168, INTC: 21, NFLX: 900, TSLA: 248, UBER: 72,
  PEP: 158, SQ: 82, MARA: 21, SHOP: 96, NIO: 5, PLTR: 78, COIN: 265,
  SPOT: 540, RIVN: 12, DIS: 102, NKE: 75, JPM: 260, V: 320, MA: 540,
  WMT: 98, XOM: 112, KO: 63, PFE: 26, JNJ: 142, BAC: 48, HD: 410,
  COST: 940, TGT: 125,
};

const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "AMD", "INTC",
  "TSLA", "NFLX", "UBER", "SQ", "SHOP", "NIO", "PLTR", "COIN", "DIS",
  "NKE", "JPM", "V", "MA", "WMT", "XOM", "KO", "PFE", "BAC", "HD", "COST",
];

const META_PATH = process.env.META_CSV ?? "../symbols_valid_meta.csv";

async function main() {
  const requested = process.argv.slice(2);
  const want = requested.length ? requested : DEFAULT_SYMBOLS;

  const text = readFileSync(META_PATH, "utf-8");
  const rows = text.split(/\r?\n/).slice(1);
  const available = new Set<string>();
  for (const line of rows) {
    const sym = line.split(",")[1]?.trim();
    if (sym) available.add(sym);
  }

  const symbols = want.filter((s) => available.has(s));
  const missing = want.filter((s) => !available.has(s));
  if (symbols.length === 0) {
    console.error(`no symbols found in ${META_PATH}`);
    process.exit(1);
  }
  if (missing.length) console.warn(`skipping (not in meta csv): ${missing.join(", ")}`);

  const basePrices = Object.fromEntries(
    symbols.map((s) => [s, BASE_PRICES[s] ?? 100 + Math.random() * 400]),
  );

  const result = await generateSyntheticDataset({
    name: `test_real_${symbols.length}syms_180m`,
    symbols,
    durationMinutes: 180,
    spacingMs: 1000,
    basePrices,
    seed: 42,
  });

  console.log(
    `loaded dataset #${result.datasetId}: ${symbols.length} symbols, ${result.rows.toLocaleString()} ticks`,
  );
  console.log(symbols.join(" "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
