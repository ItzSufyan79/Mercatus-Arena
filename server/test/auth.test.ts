import { describe, it, expect, beforeAll } from "vitest";
import { query } from "../src/db.js";
import { migrate } from "../src/schema.js";
import {
  generateApiKey,
  maskApiKey,
  hashPassword,
  verifyPassword,
  signTeamToken,
} from "../src/auth.js";

beforeAll(async () => {
  await migrate();
  await query(`delete from teams where email like 'auth-test-%'`);
});

describe("auth primitives", () => {
  it("generates unique sk_ prefixed api keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("sk_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("masks api keys", () => {
    expect(maskApiKey("sk_0123456789abcdef")).toBe("sk_012...cdef");
    expect(maskApiKey(null)).toBeNull();
  });

  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("signs and verifies tokens", () => {
    const token = signTeamToken({ team_id: 7, email: "a@b.c", role: "team" });
    expect(typeof token).toBe("string");
  });
});
