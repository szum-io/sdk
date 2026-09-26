import { debug, isDebugEnabled } from "./debug";
import {
  createSzumError,
  SzumAPIError,
  SzumConnectionError,
  SzumError,
  SzumRateLimitError,
} from "./errors";
import { SDK_VERSION } from "./version";
import { isApiFailure } from "./generated/response-validators.js";
import type { ApiFailure } from "./generated/failure";
import { assertTransportOptions, MAX_TIMER_MS } from "./options";

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
  acceptedStatuses?: readonly number[];
  retryMode?: "safe" | "rate-limit-only";
};

export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  opts: FetchOptions,
): Promise<Response> => {
  assertTransportOptions(opts);
  opts.signal?.throwIfAborted();
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, opts);

      if (!response.ok && !opts.acceptedStatuses?.includes(response.status)) {
        await handleErrorResponse(response);
      }

      return response;
    } catch (err) {
      lastError = err;

      if (
        opts.signal?.aborted ||
        !isRetryable(err, opts.retryMode ?? "safe") ||
        attempt >= opts.maxRetries
      ) {
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
      signal: opts.signal
        ? AbortSignal.any([controller.signal, opts.signal])
        : controller.signal,
    });
    const body = await response.arrayBuffer();

    if (debugEnabled) {
      debug(`← ${response.status} (${Date.now() - start}ms)`);
    }

    return new Response(
      response.status === 204 ||
        response.status === 205 ||
        response.status === 304
        ? null
        : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } catch (error) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason;
    }

    if (controller.signal.aborted) {
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

    throw new SzumConnectionError({
      message:
        error instanceof Error && error.message
          ? `Network request failed: ${error.message}`
          : "Network request failed",
      status: 0,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const handleErrorResponse = async (response: Response): Promise<never> => {
  let message =
    response.statusText || `Request failed with HTTP ${response.status}`;
  let failure: ApiFailure | null = null;

  try {
    const text = await response.text();

    try {
      const body: unknown = JSON.parse(text);

      if (isApiFailure(body)) {
        message = body.error.message;
        failure = body;
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
    failure,
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

  if (/^\d+$/.test(header)) {
    const seconds = Number(header);

    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  const date = header.endsWith("GMT") ? header : `${header} GMT`;
  const timestamp = /^[A-Za-z]+,? /.test(header) ? Date.parse(date) : NaN;

  return Number.isFinite(timestamp)
    ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
    : null;
};

const isRetryable = (
  err: unknown,
  retryMode: "safe" | "rate-limit-only",
): boolean => {
  if (err instanceof SzumError && err.retryable === false) {
    return false;
  }

  if (err instanceof SzumRateLimitError) {
    return true;
  }

  if (retryMode === "rate-limit-only") {
    return false;
  }

  if (err instanceof SzumConnectionError) {
    return true;
  }

  if (
    err instanceof SzumError &&
    err.status === 409 &&
    err.retryAfter !== null
  ) {
    return true;
  }

  if (err instanceof SzumAPIError) {
    return err.status === 502 || err.status === 503 || err.status === 504;
  }

  return false;
};

const computeRetryDelay = (attempt: number, err: SzumError): number => {
  if (err.retryAfter !== null) {
    return err.retryAfter * 1000;
  }

  const exp = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);

  return Math.max(0, exp + jitter);
};

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  for (let remaining = ms; remaining > 0; remaining -= MAX_TIMER_MS) {
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        onAbort = () => reject(signal?.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(resolve, Math.min(remaining, MAX_TIMER_MS));
      });
    } finally {
      clearTimeout(timer);

      if (onAbort) {
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  signal?.throwIfAborted();
};
