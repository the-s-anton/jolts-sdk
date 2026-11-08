export type EventKind = "rendered" | "viewable" | "click";

export interface AdRequest {
  opportunity_id: string;
  answer_id: string;
  completed_at: string;
  origin: string;
  context: {
    summary?: string;
    keywords?: string[];
    messages?: { role: "user" | "assistant"; content: string }[];
  };
  privacy: { contextual_ads: boolean; measurement: boolean; audience_insights?: boolean };
  user?: { id?: string; session_id?: string; actor?: "unknown" | "human" | "agent" };
  device?: {
    ip?: string;
    user_agent?: string;
    country?: string;
    region?: string;
    language?: string;
  };
}

export interface Delivery {
  id: string;
  answer_id: string;
  format: "card";
  expires_at: string;
  server_time: string;
  ttl_ms: number;
  disclosure: string;
  creative: { sponsor: string; headline: string; description: string };
  actions: { click_url: string };
  measurement: {
    url: string;
    tokens: Record<EventKind, string>;
    minimum_visible_ratio: number;
    continuous_visible_ms: number;
  };
}

export interface Diagnostic {
  code: "timeout" | "aborted" | "network" | "http" | "invalid_response" | "measurement_failed";
  status?: number;
}

export type OnError = (diagnostic: Diagnostic) => void;
export const DEFAULT_TIMEOUT_MS = 1500;
const MAX_RESPONSE_BYTES = 65_536;

export function notify(onError: OnError | undefined, diagnostic: Diagnostic): void {
  try {
    onError?.(diagnostic);
  } catch {
    // A diagnostic callback must not break the publisher's answer or navigation.
  }
}

export function safeUrl(value: unknown, origin?: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.hostname.endsWith(".localhost");
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
      !url.username &&
      !url.password &&
      (!origin || url.origin === origin)
    );
  } catch {
    return false;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseDelivery(value: unknown, origin?: string): Delivery | null {
  const ad = object(value);
  if (!ad) return null;
  const creative = object(ad.creative);
  const measurement = object(ad.measurement);
  const tokens = object(measurement?.tokens);
  const actions = object(ad.actions);
  if (
    !text(ad.id) ||
    !text(ad.answer_id) ||
    ad.format !== "card" ||
    !text(ad.expires_at) ||
    !Number.isFinite(Date.parse(ad.expires_at)) ||
    !text(ad.server_time) ||
    !Number.isFinite(Date.parse(ad.server_time)) ||
    !positive(ad.ttl_ms) ||
    !text(ad.disclosure) ||
    !text(creative?.sponsor) ||
    !text(creative.headline) ||
    !text(creative.description) ||
    !safeUrl(actions?.click_url, origin) ||
    !safeUrl(measurement?.url, origin) ||
    !text(tokens?.rendered) ||
    !text(tokens.viewable) ||
    !text(tokens.click) ||
    !positive(measurement.minimum_visible_ratio) ||
    measurement.minimum_visible_ratio > 1 ||
    !positive(measurement.continuous_visible_ms)
  )
    return null;

  return {
    id: ad.id,
    answer_id: ad.answer_id,
    format: "card",
    expires_at: ad.expires_at,
    server_time: ad.server_time,
    ttl_ms: ad.ttl_ms,
    disclosure: ad.disclosure,
    creative: {
      sponsor: creative.sponsor,
      headline: creative.headline,
      description: creative.description,
    },
    actions: { click_url: actions.click_url },
    measurement: {
      url: measurement.url,
      tokens: { rendered: tokens.rendered, viewable: tokens.viewable, click: tokens.click },
      minimum_visible_ratio: measurement.minimum_visible_ratio,
      continuous_visible_ms: measurement.continuous_visible_ms,
    },
  };
}

export async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function requestStatus(value: unknown): string | undefined {
  const status = object(value)?.status;
  return typeof status === "string" ? status : undefined;
}

export function responseDelivery(value: unknown): unknown {
  return object(value)?.delivery;
}
