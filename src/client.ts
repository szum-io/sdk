import type { ChartConfigInput } from "./generated/types";
import {
  createSzumError,
  SzumAPIError,
  SzumConnectionError,
  SzumError,
  SzumRateLimitError,
} from "./errors";
import { SCHEMA_VERSION } from "./generated/version";
import { SDK_VERSION } from "./version";

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
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30_000;

const USER_AGENT =
  typeof process !== "undefined" && process.versions?.node
    ? `szum-sdk/${SDK_VERSION} node/${process.versions.node}`
    : `szum-sdk/${SDK_VERSION}`;

const isDebugEnabled = (): boolean => {
  return process.env.SZUM_DEBUG === "true";
};

const debug = (msg: string): void => {
  console.error(`[szum-sdk] ${msg}`);
};

const parseRetryAfter = (response: Response): number | null => {
  const header = response.headers.get("retry-after");

  if (!header) {
    return null;
  }

  const seconds = parseInt(header, 10);

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }

  return null;
};

const parseRequestId = (response: Response): string | null => {
  return response.headers.get("x-vercel-id");
};

const combineSignals = (
  a: AbortSignal,
  b: AbortSignal | undefined,
): AbortSignal => {
  if (!b) {
    return a;
  }

  if (a.aborted) {
    return a;
  }

  if (b.aborted) {
    return b;
  }

  const controller = new AbortController();

  a.addEventListener("abort", () => controller.abort(a.reason), { once: true });
  b.addEventListener("abort", () => controller.abort(b.reason), { once: true });

  return controller.signal;
};

const isRetryable = (err: unknown): boolean => {
  if (err instanceof SzumConnectionError) {
    return true;
  }

  if (err instanceof SzumRateLimitError) {
    return true;
  }

  if (err instanceof SzumAPIError) {
    return err.status === 502 || err.status === 503 || err.status === 504;
  }

  return false;
};

const computeRetryDelay = (attempt: number, err: SzumError): number => {
  if (err instanceof SzumRateLimitError && err.retryAfter !== null) {
    return err.retryAfter * 1000;
  }

  const exp = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);

  return Math.max(0, exp + jitter);
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
};

const handleErrorResponse = async (response: Response): Promise<never> => {
  let message = response.statusText;

  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as Record<string, unknown>;

      if (typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      if (text.length > 0) {
        message = text;
      }
    }
  } catch {}

  throw createSzumError({
    message,
    status: response.status,
    retryAfter: parseRetryAfter(response),
    requestId: parseRequestId(response),
  });
};

export class Szum {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor({ apiKey, baseUrl, timeout, maxRetries }: SzumOptions) {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      throw new Error(
        "@szum-io/sdk is server-side only. Running it in a browser would expose your API key. Generate signed URLs server-side and pass them to the client.",
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
  }

  private createHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const timeout = options?.timeout ?? this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);
    const debugEnabled = isDebugEnabled();
    const start = debugEnabled ? Date.now() : 0;

    if (debugEnabled) {
      debug(`${init.method} ${url}`);
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: combineSignals(controller.signal, options?.signal),
      });
      if (debugEnabled) {
        debug(`← ${response.status} (${Date.now() - start}ms)`);
      }

      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (options?.signal?.aborted) {
          if (debugEnabled) {
            debug(`← aborted by caller (${Date.now() - start}ms)`);
          }

          throw error;
        }

        if (debugEnabled) {
          debug(`← timeout after ${timeout}ms`);
        }

        throw new SzumConnectionError({
          message: `Request timed out after ${timeout}ms`,
          status: 0,
        });
      }

      if (debugEnabled) {
        debug(`← network error (${Date.now() - start}ms)`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, init, options);

        if (!response.ok) {
          await handleErrorResponse(response);
        }

        return response;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt >= this.maxRetries) {
          throw err;
        }

        const delay = computeRetryDelay(attempt, err as SzumError);
        if (isDebugEnabled()) {
          debug(
            `retrying in ${Math.round(delay)}ms (attempt ${attempt + 2}/${this.maxRetries + 1})`,
          );
        }

        await sleep(delay, options?.signal);
      }
    }

    throw lastError;
  }

  private resolveConfig(config: ChartConfig): ChartConfigInput {
    return {
      ...config,
      version: config.version ?? SCHEMA_VERSION,
    } as ChartConfigInput;
  }

  async render(
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    const response = await this.fetchWithRetry(
      `${this.baseUrl}/chart`,
      {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify(this.resolveConfig(config)),
      },
      options,
    );

    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
  }

  async signedUrl(
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<string> {
    const response = await this.fetchWithRetry(
      `${this.baseUrl}/api/signed-url`,
      {
        method: "POST",
        headers: this.createHeaders(),
        body: JSON.stringify({ config: this.resolveConfig(config) }),
      },
      options,
    );

    const body: unknown = await response.json();
    const url =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).url
        : undefined;

    if (typeof url !== "string") {
      throw new SzumAPIError({
        message: "Invalid response: missing 'url' field",
        status: response.status,
        requestId: parseRequestId(response),
      });
    }

    return url;
  }
}
