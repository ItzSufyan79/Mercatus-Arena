import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query } from "../src/db.js";
import { migrate } from "../src/schema.js";
import { parseGrades, gradeWithLLM, autogradeSubmissions } from "../src/autograder.js";
import { config } from "../src/config.js";

let teamId: number;

beforeAll(async () => {
  await migrate();
  process.env.LLM_API_KEY = "test-llm-key";
  const { rows } = await query(
    `insert into teams (team_name, role, email, cash_balance, total_portfolio_value, starting_capital)
     values ('autograder-team', 'team', 'autograder@test', 100000, 100000, 100000)
     returning team_id`,
  );
  teamId = Number(rows[0].team_id);
});

afterAll(async () => {
  await query(`delete from submissions where team_id = $1`, [teamId]);
  await query(`delete from scoring where team_id = $1`, [teamId]);
  await query(`delete from teams where team_id = $1`, [teamId]);
});

describe("parseGrades", () => {
  it("parses a plain JSON object", () => {
    expect(parseGrades('{"code_quality": 85, "strategy_report": 90}')).toEqual({
      code_quality: 85,
      strategy_report: 90,
    });
  });

  it("strips markdown code fences", () => {
    const raw = "```json\n{\"code_quality\": 70, \"strategy_report\": 65}\n```";
    expect(parseGrades(raw)).toEqual({ code_quality: 70, strategy_report: 65 });
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = 'Sure! Here you go: {"code_quality": 50, "strategy_report": 60} done.';
    expect(parseGrades(raw)).toEqual({ code_quality: 50, strategy_report: 60 });
  });

  it("clamps out-of-range values", () => {
    expect(parseGrades('{"code_quality": 150, "strategy_report": -5}')).toEqual({
      code_quality: 100,
      strategy_report: 0,
    });
  });

  it("returns null for garbage", () => {
    expect(parseGrades("not json at all")).toBeNull();
    expect(parseGrades('{"code_quality": "high"}')).toBeNull();
  });
});

describe("gradeWithLLM", () => {
  it("calls the LLM and returns parsed grades", async () => {
    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    const mockFetch = (async (url: string, init: RequestInit) => {
      captured = {
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: String(init.body),
      };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"code_quality": 88, "strategy_report": 92}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const grades = await gradeWithLLM("report text here", "def algo(): pass", { fetchImpl: mockFetch });

    expect(grades).toEqual({ code_quality: 88, strategy_report: 92 });
    expect(captured!.url).toContain("/chat/completions");
    expect(captured!.headers.Authorization).toBe("Bearer test-llm-key");
    expect(captured!.body).toContain("report text here");
    expect(captured!.body).toContain("def algo(): pass");
  });

  it("returns null when no API key is set", async () => {
    const prevEnv = process.env.LLM_API_KEY;
    const prevCfg = config.llm.apiKey;
    delete process.env.LLM_API_KEY;
    config.llm.apiKey = null;
    try {
      const grades = await gradeWithLLM("text", null, { fetchImpl: fetch });
      expect(grades).toBeNull();
    } finally {
      if (prevEnv !== undefined) process.env.LLM_API_KEY = prevEnv;
      config.llm.apiKey = prevCfg;
    }
  });
});

describe("autogradeSubmissions", () => {
  it("grades a submission and upserts scores", async () => {
    await query(
      `insert into submissions (team_id, pdf_data, pdf_name, code_repository_link)
       values ($1, null, null, null)
       on conflict (team_id) do nothing`,
      [teamId],
    );
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"code_quality": 74, "strategy_report": 81}' } }],
        }),
        { status: 200 },
      )) as typeof fetch;

    const results = await autogradeSubmissions({ teamId, fetchImpl: mockFetch });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ok");
    expect(results[0].code_quality).toBe(74);
    expect(results[0].strategy_report).toBe(81);

    const { rows } = await query(
      `select code_quality_score, strategy_report_score from scoring where team_id = $1`,
      [teamId],
    );
    expect(Number(rows[0].code_quality_score)).toBe(74);
    expect(Number(rows[0].strategy_report_score)).toBe(81);
  });
});
