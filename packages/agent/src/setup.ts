import { constants, generateKeyPairSync, type KeyObject, privateDecrypt } from "node:crypto";
import { connectionDigest, installEnvironment } from "./environment.js";

type Result = { status: string; approval_url?: string; file?: string };
type Dependencies = {
  fetch: typeof fetch;
  install: typeof installEnvironment;
  digest: typeof connectionDigest;
};

export class Setup {
  private key?: KeyObject;
  private installation?: { token: string; url: string; file: string };
  private statusUrl?: string;
  private result?: Result;
  private pending?: Promise<Result>;
  private readonly endpoint: URL;

  constructor(
    private readonly directory: string,
    endpoint: string,
    private readonly dependencies: Dependencies = {
      fetch,
      install: installEnvironment,
      digest: connectionDigest,
    },
  ) {
    this.endpoint = new URL(endpoint);
    const local =
      ["localhost", "127.0.0.1", "[::1]"].includes(this.endpoint.hostname) ||
      this.endpoint.hostname.endsWith(".localhost");
    if (
      (this.endpoint.protocol !== "https:" && !(local && this.endpoint.protocol === "http:")) ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.hash
    ) {
      throw new Error("Use a secure publisher setup URL.");
    }
  }

  begin(): Promise<Result> {
    return this.run(() => this.start());
  }

  replace(): Promise<Result> {
    return this.run(async () => {
      if (this.result?.status === "installed") this.result = undefined;
      if (this.result) throw new Error("Finish the current setup before replacing it.");
      return this.start(this.dependencies.digest(this.directory));
    });
  }

  private async start(previousDigest?: string): Promise<Result> {
    if (this.result) return this.result;
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const response = await this.request(this.endpoint.href, {
      method: "POST",
      body: JSON.stringify({
        public_key: pair.publicKey.export({ type: "spki", format: "pem" }),
        ...(previousDigest ? { previous_digest: previousDigest } : {}),
      }),
    });
    const approvalUrl = this.responseUrl(response.approval_url);
    this.statusUrl = this.responseUrl(response.status_url);
    this.key = pair.privateKey;
    this.result = { status: "pending", approval_url: approvalUrl };
    return this.result;
  }

  finish(): Promise<Result> {
    return this.run(async () => {
      if (this.result?.status === "installed") return this.result;
      if (this.installation) return this.confirmInstallation();
      if (!this.statusUrl || !this.key) throw new Error("Start publisher setup first.");
      const response = await this.request(this.statusUrl, { method: "GET" });
      if (["pending", "denied", "expired"].includes(String(response.status))) {
        if (response.status !== "pending") {
          this.key = undefined;
          this.statusUrl = undefined;
          this.result = undefined;
        }
        return { status: String(response.status) };
      }
      if (response.status !== "approved" || typeof response.encrypted_token !== "string") {
        throw new Error("Invalid setup response.");
      }
      const endpoint = this.responseUrl(response.requests_url);
      const configurationUrl = this.responseUrl(response.configuration_url);
      const installationUrl = this.responseUrl(response.installation_url);
      const previousDigest = response.previous_digest;
      if (
        previousDigest !== undefined &&
        (typeof previousDigest !== "string" || !/^[a-f0-9]{64}$/.test(previousDigest))
      ) {
        throw new Error("Invalid setup response.");
      }
      const token = privateDecrypt(
        { key: this.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        Buffer.from(response.encrypted_token, "base64"),
      ).toString("utf8");
      const file = this.dependencies.install(
        this.directory,
        token,
        endpoint,
        previousDigest,
        configurationUrl,
      );
      this.key = undefined;
      this.installation = { token, url: installationUrl, file };
      return this.confirmInstallation();
    });
  }

  private async confirmInstallation(): Promise<Result> {
    const installation = this.installation;
    if (!installation) throw new Error("Install the connection first.");
    const response = await this.request(installation.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${installation.token}` },
    });
    if (response.status !== "installed") throw new Error("Installation was not acknowledged.");
    this.result = { status: "installed", file: installation.file };
    this.installation = undefined;
    return this.result;
  }

  private run(operation: () => Promise<Result>): Promise<Result> {
    if (this.pending) return this.pending;
    this.pending = operation().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private responseUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("Invalid setup response.");
    const url = new URL(value);
    if (url.origin !== this.endpoint.origin || url.username || url.password || url.hash) {
      throw new Error("Invalid setup response.");
    }
    return url.href;
  }

  private async request(url: string, options: RequestInit): Promise<Record<string, unknown>> {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    const response = await this.dependencies.fetch(url, {
      ...options,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 410) return { status: "expired" };
    if (!response.ok) throw new Error("Publisher setup could not complete. Try again.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Invalid setup response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) throw new Error("Invalid setup response.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid setup response.");
    return data as Record<string, unknown>;
  }
}
