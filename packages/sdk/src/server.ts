import {
  type AdRequest,
  DEFAULT_TIMEOUT_MS,
  type Delivery,
  notify,
  type OnError,
  parseDelivery,
  readJson,
  requestStatus,
  responseDelivery,
  safeUrl,
} from "./protocol.js";

export type { AdRequest, Delivery, Diagnostic } from "./protocol.js";

export interface ClientOptions {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  onError?: OnError;
}

export function createClient({
  endpoint,
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onError,
}: ClientOptions) {
  if (typeof window !== "undefined") throw new Error("The Jolts client belongs on your server");
  if (!safeUrl(endpoint) || !apiKey || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Jolts requires a secure endpoint, server credential and positive timeout");
  }
  const origin = new URL(endpoint).origin;

  return {
    async requestAd(input: AdRequest, signal?: AbortSignal): Promise<Delivery | null> {
      const started = performance.now();
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
      let received = false;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(input),
          signal: combined,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        });
        if (!response.ok) {
          notify(onError, { code: "http", status: response.status });
          await response.body?.cancel();
          return null;
        }
        received = true;
        const body = await readJson(response);
        const status = requestStatus(body);
        if (status === "no_fill" || status === "expired") return null;
        const ad = status === "delivered" ? parseDelivery(responseDelivery(body), origin) : null;
        if (!ad || ad.answer_id !== input.answer_id) {
          notify(onError, { code: "invalid_response" });
          return null;
        }
        ad.ttl_ms =
          Math.min(ad.ttl_ms, Date.parse(ad.expires_at) - Date.parse(ad.server_time)) -
          (performance.now() - started);
        return ad.ttl_ms > 0 ? ad : null;
      } catch {
        const code = signal?.aborted
          ? "aborted"
          : deadline.signal.aborted
            ? "timeout"
            : received
              ? "invalid_response"
              : "network";
        notify(onError, { code });
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
