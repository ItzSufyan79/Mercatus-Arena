import { query } from "./db.js";
import { config } from "./config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";

const execFileAsync = promisify(execFile);

const SOURCE_EXT = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".sol", ".kt",
  ".swift", ".sh", ".cs",
]);

const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  "dist", "build", ".next", "vendor", "target", "env",
]);

const MAX_CODE_CHARS = 20_000;
const MAX_FILES = 5;

export interface GradeResult {
  team_id: number;
  team_name: string;
  code_quality: number | null;
  strategy_report: number | null;
  code_source: "code" | "report_only" | "none";
  status: "ok" | "no_submission" | "llm_error" | "no_llm_key";
  error?: string;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text ?? "";
}

export async function cloneRepoText(url: string): Promise<string | null> {
  if (!/^(https?|git@)/.test(url)) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "mercatus-grade-"));
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--quiet", url, dir], {
      timeout: 30_000,
    });
    const chunks: string[] = [];
    const candidates: { p: string; size: number }[] = [];

    async function walk(dirPath: string) {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(path.join(dirPath, e.name));
        } else if (e.isFile()) {
          if (SOURCE_EXT.has(path.extname(e.name))) {
            const p = path.join(dirPath, e.name);
            try {
              const s = await stat(p);
              if (s.size <= 1_000_000) candidates.push({ p, size: s.size });
            } catch {
              /* unreadable */
            }
          }
        }
      }
    }

    await walk(dir);
    candidates.sort((a, b) => b.size - a.size);
    let total = 0;
    for (const c of candidates.slice(0, MAX_FILES)) {
      try {
        const text = await readFile(c.p, "utf8");
        chunks.push(`--- ${path.basename(c.p)} ---\n${text.slice(0, 6_000)}`);
        total += text.length;
        if (total >= MAX_CODE_CHARS) break;
      } catch {
        /* binary or unreadable */
      }
    }
    return chunks.length > 0 ? chunks.join("\n\n") : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function parseGrades(raw: string): { code_quality: number; strategy_report: number } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  const cq = Number(rec.code_quality);
  const sr = Number(rec.strategy_report);
  if (!Number.isFinite(cq) || !Number.isFinite(sr)) return null;
  return {
    code_quality: Math.min(100, Math.max(0, Math.round(cq * 100) / 100)),
    strategy_report: Math.min(100, Math.max(0, Math.round(sr * 100) / 100)),
  };
}

export interface LLMOpts {
  fetchImpl?: typeof fetch;
}

export async function gradeWithLLM(
  reportText: string,
  codeText: string | null,
  opts: LLMOpts = {},
): Promise<{ code_quality: number; strategy_report: number } | null> {
  const apiKey = process.env.LLM_API_KEY ?? config.llm.apiKey;
  if (!apiKey) return null;
  const model = process.env.LLM_MODEL ?? config.llm.model;
  const baseUrl = process.env.LLM_BASE_URL ?? config.llm.baseUrl;
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? config.llm.timeoutMs);
  const f = opts.fetchImpl ?? fetch;

  const reportBlock = reportText
    ? `<REPORT>\n${reportText.slice(0, 16_000)}\n</REPORT>`
    : "<REPORT>(no report text was extractable)</REPORT>";
  const codeBlock = codeText
    ? `<CODE>\n${codeText}\n</CODE>`
    : "<CODE>(code not available; base the code-quality grade on any implementation detail in the report)</CODE>";

  const prompt = `Grade this algorithmic-trading competition submission on two 0-100 integer scales.

${reportBlock}

${codeBlock}

Rubric:
- code_quality: correctness, structure, risk management, and engineering quality of the trading algorithm. If full code is unavailable, grade from implementation details described in the report.
- strategy_report: clarity, completeness, and quality of the written strategy explanation.

Respond with JSON only, no markdown: {"code_quality": <0-100 integer>, "strategy_report": <0-100 integer>}`;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await f(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a strict, fair judge for an algorithmic-trading competition. You always respond with valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) break;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(attempt * 1_500);
      continue;
    }
    throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res!.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  const grades = parseGrades(content);
  if (!grades) throw new Error("LLM returned unparseable output");
  return grades;
}

export async function autogradeSubmissions(
  opts: { teamId?: number; fetchImpl?: typeof fetch } = {},
): Promise<GradeResult[]> {
  const params: unknown[] = [];
  const where = opts.teamId ? "where s.team_id = $1" : "";
  if (opts.teamId) params.push(opts.teamId);
  const { rows } = await query(
    `select s.team_id, t.team_name, s.pdf_data, s.code_repository_link
     from submissions s
     join teams t on t.team_id = s.team_id
     ${where}
     order by s.team_id`,
    params,
  );
  if (rows.length === 0) return [];

  const results: GradeResult[] = [];
  for (const row of rows) {
    try {
      let reportText = "";
      if (row.pdf_data) {
        try {
          reportText = await extractPdfText(row.pdf_data);
        } catch {
          reportText = "";
        }
      }
      const codeText = row.code_repository_link
        ? await cloneRepoText(row.code_repository_link)
        : null;
      const grades = await gradeWithLLM(reportText, codeText, { fetchImpl: opts.fetchImpl });
      if (!grades) {
        results.push({
          team_id: Number(row.team_id),
          team_name: row.team_name,
          code_quality: null,
          strategy_report: null,
          code_source: codeText ? "code" : row.pdf_data ? "report_only" : "none",
          status: "no_llm_key",
        });
        continue;
      }
      await query(
        `insert into scoring (team_id, code_quality_score, strategy_report_score, updated_at)
         values ($1, $2, $3, now())
         on conflict (team_id) do update
         set code_quality_score = excluded.code_quality_score,
             strategy_report_score = excluded.strategy_report_score,
             updated_at = now()`,
        [row.team_id, grades.code_quality, grades.strategy_report],
      );
      results.push({
        team_id: Number(row.team_id),
        team_name: row.team_name,
        code_quality: grades.code_quality,
        strategy_report: grades.strategy_report,
        code_source: codeText ? "code" : row.pdf_data ? "report_only" : "none",
        status: "ok",
      });
    } catch (err) {
      results.push({
        team_id: Number(row.team_id),
        team_name: row.team_name,
        code_quality: null,
        strategy_report: null,
        code_source: "none",
        status: "llm_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
