import type { ChartConfig, ChartDocument } from "./contracts";
import { SzumInvalidRequestError } from "./errors";
import type { ChartDocumentInput } from "./generated/document";
import type { ChartConfigInput } from "./generated/types";
import { SCHEMA_VERSION } from "./generated/version";

const DEFAULT_BASE_URL = "https://szum.io";
export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_TIMER_MS = 2_147_483_647;

export const resolveBaseUrl = (baseUrl = DEFAULT_BASE_URL): string => {
  const url = new URL(baseUrl);

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "baseUrl must be an HTTP(S) URL without credentials, query parameters or a fragment",
    );
  }

  return url.href.replace(/\/+$/, "");
};

export const resolveDocument = (
  document: ChartDocument,
): ChartDocumentInput => ({
  ...document,
  version: document.version ?? SCHEMA_VERSION,
  config: resolveConfig(document.config),
});

export const assertTransportOptions = ({
  timeout,
  maxRetries,
}: {
  timeout?: number;
  maxRetries?: number;
}): void => {
  if (
    timeout !== undefined &&
    (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMER_MS)
  ) {
    throw new Error(
      `timeout must be a positive number no greater than ${MAX_TIMER_MS}ms`,
    );
  }

  if (
    maxRetries !== undefined &&
    (!Number.isSafeInteger(maxRetries) || maxRetries < 0)
  ) {
    throw new Error("maxRetries must be a non-negative integer");
  }
};

export const assertSharedTheme = (sharedTheme: unknown): void => {
  if (sharedTheme !== undefined && !isSharedThemeName(sharedTheme)) {
    throw new SzumInvalidRequestError({
      message: "sharedTheme must be a non-empty string",
      status: 0,
    });
  }
};

export const assertSharedThemeChoice = (sharedTheme: unknown): void => {
  if (
    sharedTheme !== undefined &&
    sharedTheme !== null &&
    !isSharedThemeName(sharedTheme)
  ) {
    throw new SzumInvalidRequestError({
      message: "sharedTheme must be a non-empty string or null",
      status: 0,
    });
  }
};

const isSharedThemeName = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const resolveConfig = (config: ChartConfig): ChartConfigInput => {
  const resolved: ChartConfigInput = {
    ...config,
    version: config.version ?? SCHEMA_VERSION,
  };

  return resolved;
};
