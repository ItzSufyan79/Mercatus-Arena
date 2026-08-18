import { Router, type Response } from "express";
import { requireApiKey, type AuthedRequest } from "../auth.js";
import { executeOrder } from "../atomic.js";
import { serverError } from "../http.js";

export const tradeRoutes = Router();

function validateOrder(body: any): string | null {
  if (!body || typeof body !== "object") return "INVALID_BODY";
  const { symbol, quantity, price, client_ref } = body;
  if (typeof symbol !== "string" || !/^[A-Z0-9.]{1,10}$/.test(symbol)) {
    return "INVALID_SYMBOL";
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100_000_000) {
    return "INVALID_QUANTITY";
  }
  if (price !== undefined && price !== null) {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return "INVALID_PRICE";
    }
  }
  if (client_ref !== undefined && (typeof client_ref !== "string" || client_ref.length > 64)) {
    return "INVALID_CLIENT_REF";
  }
  return null;
}

async function handleOrder(req: AuthedRequest, res: Response, action: "BUY" | "SELL") {
  const invalid = validateOrder(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const { symbol, quantity, price, client_ref } = req.body;
  try {
    const result = await executeOrder({
      teamId: req.team!.team_id,
      action,
      symbol,
      quantity,
      price: price ?? null,
      clientRef: client_ref,
    });
    if (result.status === "REJECTED") {
      return res.status(422).json(result);
    }
    res.json(result);
  } catch (err) {
    serverError(res, err);
  }
}

tradeRoutes.post("/buy", requireApiKey, (req, res) => handleOrder(req, res, "BUY"));
tradeRoutes.post("/sell", requireApiKey, (req, res) => handleOrder(req, res, "SELL"));
