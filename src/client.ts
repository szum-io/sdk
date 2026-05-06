import { SzumCharts } from "./charts";
import type { ChartConfigInput } from "./generated/types";
import { SCHEMA_VERSION } from "./generated/version";
import { fetchWithRetry, USER_AGENT } from "./http";

export type ChartConfig = Omit<ChartConfigInput, "version"> & {
  version?: ChartConfigInput["version"];
};

export type SzumOptions = {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
};

export type RequestOptions = {
  timeout?: number;
  signal?: AbortSignal;
};

const DEFAULT_BASE_URL = "https://szum.io";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;

export class Szum {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  readonly charts: SzumCharts;

  constructor({ apiKey, baseUrl, timeout, maxRetries }: SzumOptions) {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      throw new Error(
        "@szum-io/sdk is server-side only. Running it in a browser would expose your API key. Save charts server-side and pass the URLs to the client.",
      );
    }

    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("apiKey is required and must be a non-empty string");
    }

    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      throw new Error("timeout must be a positive number");
    }

    if (
      maxRetries !== undefined &&
      (!Number.isInteger(maxRetries) || maxRetries < 0)
    ) {
      throw new Error("maxRetries must be a non-negative integer");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = maxRetries ?? DEFAULT_MAX_RETRIES;

    this.charts = new SzumCharts({
      request: (path, init, opts) => this.request(path, init, opts),
      resolveConfig: (cfg) => this.resolveConfig(cfg),
    });
  }

  async render(
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    const response = await this.request(
      "/chart",
      {
        method: "POST",
        body: JSON.stringify(this.resolveConfig(config)),
      },
      options,
    );

    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
  }

  private async request(
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ): Promise<Response> {
    return fetchWithRetry(
      `${this.baseUrl}${path}`,
      { ...init, headers: this.createHeaders() },
      {
        timeout: options?.timeout ?? this.timeout,
        maxRetries: this.maxRetries,
        signal: options?.signal,
      },
    );
  }

  private createHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };
  }

  private resolveConfig(config: ChartConfig): ChartConfigInput {
    return {
      ...config,
      version: config.version ?? SCHEMA_VERSION,
    } as ChartConfigInput;
  }
}
