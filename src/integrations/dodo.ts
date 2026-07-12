/**
 * Dodo Payments integration — a $2 unlock for premium modes:
 *   • the full forensic breakdown (every tell, every receipt, per-tweet), and
 *   • "roast someone else" (score any handle anonymously).
 *
 * Real mode: creates a Dodo checkout session and returns the payment link.
 * Mock mode (no key): returns a mock link and treats premium as locked, so the
 * gate is demonstrable without live billing.
 */

import { config, live } from "../config.js";

const DODO_BASE: Record<string, string> = {
  test: "https://test.dodopayments.com",
  live: "https://live.dodopayments.com",
};

export interface CheckoutResult {
  url: string;
  source: "dodo" | "mock";
  reference: string;
}

/**
 * Create a checkout link for a given Telegram user + target handle. The
 * reference lets a webhook (or manual reconcile) mark that user premium.
 */
export async function createCheckout(userId: string, targetHandle: string): Promise<CheckoutResult> {
  const reference = `slopscore:${userId}:${targetHandle}:${Date.now()}`;

  if (live.dodo) {
    try {
      const base = DODO_BASE[config.dodo.env] ?? DODO_BASE.test;
      const res = await fetch(`${base}/checkouts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.dodo.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_cart: [{ product_id: config.dodo.productId, quantity: 1 }],
          metadata: { reference, userId, targetHandle },
          return_url: `${config.publicUrl}/thanks`,
        }),
      });
      if (!res.ok) throw new Error(`Dodo ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { payment_link?: string; url?: string };
      const url = data.payment_link ?? data.url;
      if (url) return { url, source: "dodo", reference };
    } catch (err) {
      console.warn(`[dodo] checkout failed, returning mock link:`, (err as Error).message);
    }
  }

  return {
    url: `${config.publicUrl}/unlock?ref=${encodeURIComponent(reference)} (mock $${config.dodo.priceUsd} checkout)`,
    source: "mock",
    reference,
  };
}

/**
 * Verify a payment reference. In real deployments this is driven by a Dodo
 * webhook that flips the user's premium flag in Convex. Here we expose a helper
 * the bot can call; in mock mode it always returns false (locked).
 */
export async function isPaid(reference: string): Promise<boolean> {
  if (!live.dodo) return false;
  try {
    const base = DODO_BASE[config.dodo.env] ?? DODO_BASE.test;
    const res = await fetch(`${base}/payments?reference=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${config.dodo.apiKey}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { items?: Array<{ status?: string }> };
    return (data.items ?? []).some((p) => p.status === "succeeded");
  } catch {
    return false;
  }
}
