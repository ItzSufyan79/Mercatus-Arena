import { writeFileSync } from "node:fs";

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

const args = process.argv.slice(2);
const seed = Number(args[0] ?? 42);
const symbols = args.slice(1).length ? args.slice(1) : ["AAPL", "MSFT", "GOOG", "TSLA", "NVDA"];
const spacingMs = 1000;
const durationMs = 180 * 60_000;

const rng = mulberry32(seed);
const drift = 0.00002;
const vol = 0.0015;
const walk = new Map<string, number>();
symbols.forEach((s, i) => walk.set(s, 100 + i * 37));

const lines: string[] = ["t,symbol,price,volume"];
const total = Math.floor(durationMs / spacingMs);
for (let seq = 1; seq <= total; seq++) {
  const t = seq * spacingMs;
  for (const symbol of symbols) {
    const prev = walk.get(symbol)!;
    const next = prev * (1 + drift + (rng() - 0.5) * 2 * vol);
    walk.set(symbol, next);
    lines.push(`${t},${symbol},${Math.round(next * 10000) / 10000},${100 + Math.floor(rng() * 900)}`);
  }
}

const file = `dataset_${seed}_${symbols.join("_")}.csv`;
writeFileSync(file, lines.join("\n"));
console.log(`wrote ${lines.length - 1} rows to ${file}`);
