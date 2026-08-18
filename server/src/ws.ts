import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { verifyToken, type TeamClaims } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";

const PROTO_PREFIX = "mercatus.";

interface ClientSocket extends WebSocket {
  isAlive: boolean;
  team_id?: number;
}

const clients = new Set<ClientSocket>();
let helloProvider: () => unknown = () => ({});

export function setHelloProvider(fn: () => unknown) {
  helloProvider = fn;
}

function protocolFromClaims(protocols: Set<string>): string | null {
  for (const p of protocols) {
    if (!p.startsWith(PROTO_PREFIX)) continue;
    const token = p.slice(PROTO_PREFIX.length);
    if (!token) continue;
    try {
      verifyToken(token);
      return p;
    } catch {
      return null;
    }
  }
  return null;
}

function claimsFromProtocol(protocol: string): TeamClaims | null {
  if (!protocol.startsWith(PROTO_PREFIX)) return null;
  const token = protocol.slice(PROTO_PREFIX.length);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function attachWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    handleProtocols: (protocols, _req) => {
      const accepted = protocolFromClaims(protocols);
      if (accepted) return accepted;
      return false;
    },
  });

  wss.on("connection", (raw, req) => {
    const ws = raw as ClientSocket;
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      ws.close(1008, "origin not allowed");
      return;
    }

    let claims: TeamClaims | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        claims = verifyToken(auth.slice(7));
      } catch {
        claims = null;
      }
    }
    if (!claims && ws.protocol?.startsWith(PROTO_PREFIX)) {
      claims = claimsFromProtocol(ws.protocol);
    }

    if (claims) {
      query(
        `select team_id, is_frozen, token_version from teams where team_id = $1`,
        [claims.team_id],
      )
        .then(({ rows }) => {
          const team = rows[0];
          if (!team || team.is_frozen || team.token_version !== (claims!.ver ?? 0)) {
            ws.close(4401, "token revoked");
            return;
          }
          ws.team_id = claims!.team_id;
          ws.send(JSON.stringify({ type: "hello", payload: helloProvider() }));
        })
        .catch(() => {
          ws.close(1011, "internal error");
        });
      clients.add(ws);
      ws.isAlive = true;
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      return;
    }

    clients.add(ws);
    ws.isAlive = true;
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    ws.send(JSON.stringify({ type: "hello", payload: helloProvider() }));
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}

export function broadcast(
  message: unknown,
  opts: { teamId?: number } = {},
) {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (opts.teamId !== undefined && ws.team_id !== opts.teamId) continue;
    try {
      ws.send(data);
    } catch {
      clients.delete(ws);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
