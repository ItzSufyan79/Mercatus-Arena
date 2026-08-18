import "dotenv/config";

export const DEFAULT_JWT_SECRET = "dev-secret-change-me";
export const DEFAULT_ADMIN_PASSWORD = "admin1234";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://mercatus:mercatus@localhost:5432/mercatus",
  jwtSecret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@mercatus.tech",
  adminPassword: process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
  tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 1000),
  defaultStartCapital: Number(process.env.DEFAULT_START_CAPITAL ?? 100000),
  defaultEventMinutes: Number(process.env.DEFAULT_EVENT_MINUTES ?? 180),
  defaultBlackoutMinutes: Number(process.env.DEFAULT_BLACKOUT_MINUTES ?? 20),
  defaultApiFreezeMinutes: Number(process.env.DEFAULT_API_FREEZE_MINUTES ?? 15),
  defaultNoiseSigma: Number(process.env.DEFAULT_NOISE_SIGMA ?? 0.0005),
  trustProxy: Number(process.env.TRUST_PROXY ?? "1"),
  isProduction: process.env.NODE_ENV === "production",
  allowedOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  registrationCode: process.env.REGISTRATION_CODE ?? null,
  minPasswordLength: Number(process.env.MIN_PASSWORD_LENGTH ?? 8),
  rateLimitStore: process.env.RATE_LIMIT_STORE ?? "postgres",
  rateLimit: {
    apiPerMin: Number(process.env.RATE_LIMIT_API ?? 300),
    authPerMin: Number(process.env.RATE_LIMIT_AUTH ?? 10),
    tradePerMin: Number(process.env.RATE_LIMIT_TRADE ?? 60),
  },
  llm: {
    apiKey: process.env.LLM_API_KEY ?? null,
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  },
};

export type EventState =
  | "PRE_LAUNCH"
  | "ACTIVE_MARKET"
  | "API_FROZEN"
  | "EVENT_CONCLUDED";
