import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import http from "node:http";
import { config, DEFAULT_ADMIN_PASSWORD, DEFAULT_JWT_SECRET } from "./config.js";
import { migrate, seedAdmin } from "./schema.js";
import { engine } from "./engine.js";
import { attachWebSocket, clientCount } from "./ws.js";
import { telemetryMiddleware } from "./telemetry.js";
import { apiLimiter, authLimiter, tradeLimiter } from "./limiter.js";
import { authRoutes } from "./routes/auth.routes.js";
import { tradeRoutes } from "./routes/trade.routes.js";
import { teamRoutes } from "./routes/team.routes.js";
import { marketRoutes } from "./routes/market.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { evaluatorRoutes } from "./routes/evaluator.routes.js";

const noopLimiter = (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
  next();

export function createApp() {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(helmet());

  const isTest = process.env.NODE_ENV === "test";
  const guard = isTest ? noopLimiter : apiLimiter;
  const authGuard = isTest ? noopLimiter : authLimiter;

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", guard, (_req, res) => {
    res.json({
      ok: true,
      state: engine.getStatus().state,
      ts: Date.now(),
    });
  });

  app.use("/api", guard, telemetryMiddleware);
  app.use("/api/auth", authGuard);
  app.use("/api/auth", authRoutes);
  app.use("/api/trade", isTest ? noopLimiter : tradeLimiter);
  app.use("/api/trade", tradeRoutes);
  app.use("/api/team", teamRoutes);
  app.use("/api/market", marketRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/evaluator", evaluatorRoutes);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (config.isProduction) {
        console.error("[mercatus] error:", err);
        return res.status(err.status ?? 500).json({ error: "INTERNAL" });
      }
      res.status(err.status ?? 500).json({
        error: "INTERNAL",
        message: err.message,
      });
    },
  );

  return app;
}

async function main() {
  if (config.isProduction) {
    if (!process.env.JWT_SECRET || config.jwtSecret === DEFAULT_JWT_SECRET) {
      console.error("FATAL: JWT_SECRET must be set to a strong value in production.");
      process.exit(1);
    }
    if (config.adminPassword === DEFAULT_ADMIN_PASSWORD) {
      console.error("FATAL: ADMIN_PASSWORD must be set to a strong value in production.");
      process.exit(1);
    }
    if (config.allowedOrigins.length === 0) {
      console.error("FATAL: CORS_ORIGIN must list at least one origin in production.");
      process.exit(1);
    }
    if (!config.registrationCode) {
      console.error("FATAL: REGISTRATION_CODE must be set in production.");
      process.exit(1);
    }
  }
  await migrate();
  await seedAdmin();
  await engine.init();

  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);

  server.listen(config.port, () => {
    console.log(
      `[mercatus] engine=${engine.getStatus().state} ws=on port=${config.port}`,
    );
  });

  const shutdown = () => {
    console.log("[mercatus] shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.env.NODE_ENV !== "test") {
  process.on("unhandledRejection", (err) => {
    console.error("[mercatus] unhandledRejection:", err);
  });
  main().catch((err) => {
    console.error("[mercatus] fatal:", err);
    process.exit(1);
  });
}
