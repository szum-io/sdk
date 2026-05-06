import { debug, isDebugEnabled } from "./debug";
import {
  createSzumError,
  SzumAPIError,
  SzumConnectionError,
  SzumError,
  SzumRateLimitError,
} from "./errors";
import { SDK_VERSION } from "./version";

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 30_000;

export const USER_AGENT =
  typeof process !== "undefined" && process.versions?.node
    ? `szum-sdk/${SDK_VERSION} node/${process.versions.node}`
    : `szum-sdk/${SDK_VERSION}`;

type FetchOptions = {
  timeout: number;
  maxRetries: number;
  signal?: AbortSignal;
};

export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  opts: FetchOptions,
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, opts);

      if (!response.ok) {
        await handleErrorResponse(response);
      }

      return response;
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt >= opts.maxRetries) {
        throw err;
      }

      const delay = computeRetryDelay(attempt, err as SzumError);

      if (isDebugEnabled()) {
        debug(
          `retrying in ${Math.round(delay)}ms (attempt ${attempt + 2}/${opts.maxRetries + 1})`,
        );
      }

      await sleep(delay, opts.signal);
    }
  }

  throw lastError;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  opts: { timeout: number; signal?: AbortSignal },
): Promise<Response> => {
  const { timeout } = opts;
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
      signal: combineSignals(controller.signal, opts.signal),
    });

    if (debugEnabled) {
      debug(`← ${response.status} (${Date.now() - start}ms)`);
    }

    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (opts.signal?.aborted) {
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

export const parseRequestId = (response: Response): string | null => {
  return response.headers.get("x-vercel-id");
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
