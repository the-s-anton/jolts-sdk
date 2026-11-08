import {
  DEFAULT_TIMEOUT_MS,
  type Delivery,
  type EventKind,
  notify,
  type OnError,
  parseDelivery,
  readJson,
} from "./protocol.js";

export type { Delivery, Diagnostic } from "./protocol.js";

interface Options {
  onError?: OnError;
  onExpire?: () => void;
}
export interface LoadOptions extends Options {
  request?: RequestInit;
  timeoutMs?: number;
}
export interface RenderOptions extends Options {
  className?: string;
}
interface State {
  deadline: number;
  sent: Set<EventKind>;
}
const states = new Map<string, State>();
const received = new WeakMap<Delivery, number>();
const mounts = new WeakMap<Element, () => void>();
const MAX_TRACKED_DELIVERIES = 128;
const RETRY_DELAY_MS = 200;

/** Fetch from the publisher's own backend. This never accepts a publisher API key. */
export async function loadAd(
  endpoint: string,
  options: LoadOptions = {},
): Promise<Delivery | null> {
  const started = performance.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const callerSignal = options.request?.signal;
  let fetching = false;
  let receivedResponse = false;
  try {
    const url = new URL(endpoint, location.href);
    if (url.origin !== location.origin) throw new Error("Use your own backend");
    if (callerSignal?.aborted) {
      notify(options.onError, { code: "aborted" });
      return null;
    }
    fetching = true;
    const response = await fetch(url, {
      ...options.request,
      signal: callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal,
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    receivedResponse = true;
    if (!response.ok) {
      notify(options.onError, { code: "http", status: response.status });
      await response.body?.cancel();
      return null;
    }
    const body = await readJson(response);
    if (body === null) return null;
    const ad = parseDelivery(body);
    if (!ad) throw new Error("Invalid delivery");
    const remaining = Math.min(
      ad.ttl_ms - (performance.now() - started),
      Date.parse(ad.expires_at) - Date.now(),
    );
    if (remaining <= 0) return null;
    received.set(ad, performance.now() + remaining);
    return ad;
  } catch {
    const code = callerSignal?.aborted
      ? "aborted"
      : deadline.signal.aborted
        ? "timeout"
        : fetching && !receivedResponse
          ? "network"
          : "invalid_response";
    notify(options.onError, { code });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stateFor(ad: Delivery): State {
  const now = performance.now();
  const deadline =
    received.get(ad) ?? now + Math.min(ad.ttl_ms, Date.parse(ad.expires_at) - Date.now());
  const existing = states.get(ad.id);
  if (existing) {
    existing.deadline = Math.min(existing.deadline, deadline);
    return existing;
  }
  for (const [id, state] of states) if (state.deadline <= now) states.delete(id);
  const first = states.keys().next().value;
  if (states.size >= MAX_TRACKED_DELIVERIES && first) states.delete(first);
  const state = { deadline, sent: new Set<EventKind>() };
  states.set(ad.id, state);
  return state;
}

async function receipt(
  ad: Delivery,
  kind: EventKind,
  evidence: Record<string, unknown>,
  onError?: OnError,
) {
  const body = JSON.stringify({
    event_id: `${ad.id}:${kind}`,
    kind,
    token: ad.measurement.tokens[kind],
    evidence,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(ad.measurement.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "omit",
        redirect: "error",
        keepalive: true,
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.ok) return;
      if (response.status < 500) {
        notify(onError, { code: "measurement_failed", status: response.status });
        return;
      }
    } catch {
      // Retry the same receipt once; server idempotency also covers lost responses.
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  notify(onError, { code: "measurement_failed" });
}

/** Observe the whole rendered card. Call dispose when your component unmounts. */
export function observeAd(element: HTMLElement, delivery: Delivery, options: Options = {}) {
  const ad = parseDelivery(delivery);
  if (!ad || typeof IntersectionObserver === "undefined") {
    return { dispose() {}, recordClick(_event: Event) {} };
  }
  const state = stateFor(delivery);
  let disposed = false;
  let ratio = 0;
  let unobscured = true;
  let minimumRatio = 1;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !disposed && element.isConnected && performance.now() < state.deadline;
  const visible = () =>
    active() && !document.hidden && unobscured && ratio >= ad.measurement.minimum_visible_ratio;
  const send = (kind: EventKind, evidence: Record<string, unknown>) => {
    if (!active() || state.sent.has(kind)) return;
    state.sent.add(kind);
    void receipt(ad, kind, evidence, options.onError);
  };
  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const acceptEntries = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      ratio = entry.intersectionRatio;
      unobscured =
        (entry as IntersectionObserverEntry & { isVisible?: boolean }).isVisible !== false;
      if (!visible()) reset();
      minimumRatio = Math.min(minimumRatio, ratio);
    }
  };
  const reconcile = () => {
    if (active()) send("rendered", {});
    if (!visible()) {
      reset();
      return;
    }
    if (timer || state.sent.has("viewable")) return;
    since = performance.now();
    minimumRatio = ratio;
    const finish = () => {
      acceptEntries(observer.takeRecords());
      const elapsed = performance.now() - since;
      if (timer && visible() && elapsed < ad.measurement.continuous_visible_ms) {
        timer = setTimeout(finish, ad.measurement.continuous_visible_ms - elapsed);
        return;
      }
      if (timer && visible())
        send("viewable", {
          visible_ratio: minimumRatio,
          continuous_visible_ms: Math.floor(elapsed),
          document_visible: true,
        });
      reset();
      reconcile();
    };
    timer = setTimeout(finish, ad.measurement.continuous_visible_ms);
  };
  const supportsVisibility = "isVisible" in IntersectionObserverEntry.prototype;
  const observer = new IntersectionObserver(
    (entries) => {
      acceptEntries(entries);
      reconcile();
    },
    {
      threshold: [0, ad.measurement.minimum_visible_ratio, 1],
      ...(supportsVisibility ? { trackVisibility: true, delay: 100 } : {}),
    },
  );
  const visibilityChanged = () => {
    reset();
    ratio = 0;
    observer.unobserve(element);
    observer.observe(element);
  };
  const expiry = setTimeout(
    () => {
      dispose();
      options.onExpire?.();
    },
    Math.max(0, state.deadline - performance.now()),
  );
  function dispose() {
    disposed = true;
    reset();
    clearTimeout(expiry);
    observer.disconnect();
    document.removeEventListener("visibilitychange", visibilityChanged);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  observer.observe(element);
  reconcile();
  return {
    dispose,
    recordClick(event: Event) {
      if (
        event.isTrusted &&
        event instanceof MouseEvent &&
        ["click", "auxclick"].includes(event.type) &&
        event.button <= 1 &&
        !document.hidden
      ) {
        send("click", { user_activation: true });
      }
    },
  };
}

/** Optional semantic renderer; inherits the host's typography and component classes. */
export function renderAd(
  container: HTMLElement,
  delivery: Delivery | null,
  options: RenderOptions = {},
): () => void {
  mounts.get(container)?.();
  if (
    !delivery ||
    typeof IntersectionObserver === "undefined" ||
    !parseDelivery(delivery) ||
    stateFor(delivery).deadline <= performance.now()
  ) {
    return () => {};
  }
  const article = document.createElement("article");
  if (options.className) article.className = options.className;
  const label = document.createElement("p");
  label.textContent = `${delivery.disclosure} · ${delivery.creative.sponsor}`;
  const heading = document.createElement("h3");
  heading.textContent = delivery.creative.headline;
  const description = document.createElement("p");
  description.textContent = delivery.creative.description;
  const link = document.createElement("a");
  link.textContent = "Learn more";
  link.href = delivery.actions.click_url;
  link.target = "_blank";
  link.rel = "sponsored noopener noreferrer";
  article.append(label, heading, description, link);
  container.replaceChildren(article);
  const observation = observeAd(article, delivery, {
    ...options,
    onExpire: () => {
      article.remove();
      options.onExpire?.();
    },
  });
  const clicked = (event: MouseEvent) => {
    if (stateFor(delivery).deadline <= performance.now()) {
      event.preventDefault();
      return;
    }
    observation.recordClick(event);
  };
  link.addEventListener("click", clicked);
  link.addEventListener("auxclick", clicked);
  const dispose = () => {
    observation.dispose();
    link.removeEventListener("click", clicked);
    link.removeEventListener("auxclick", clicked);
    article.remove();
    if (mounts.get(container) === dispose) mounts.delete(container);
  };
  mounts.set(container, dispose);
  return dispose;
}

/** Load and render one answer's ad. Cleanup cancels requests and removes observers. */
export function mountAd(
  container: HTMLElement,
  endpoint: string,
  options: LoadOptions & RenderOptions = {},
): () => void {
  mounts.get(container)?.();
  const controller = new AbortController();
  const callerSignal = options.request?.signal;
  const signal = callerSignal
    ? AbortSignal.any([controller.signal, callerSignal])
    : controller.signal;
  let remove: (() => void) | undefined;
  const dispose = () => {
    controller.abort();
    remove?.();
    if (mounts.get(container) === dispose) mounts.delete(container);
  };
  mounts.set(container, dispose);
  void loadAd(endpoint, { ...options, request: { ...options.request, signal } }).then((ad) => {
    if (signal.aborted || mounts.get(container) !== dispose) return;
    // Transfer ownership to the renderer without cancelling this pending mount.
    mounts.delete(container);
    remove = renderAd(container, ad, options);
    mounts.set(container, dispose);
  });
  return dispose;
}
