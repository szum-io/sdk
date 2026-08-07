import type { ChartConfig } from "./client";
import type { ChartConfigInput } from "./generated/types";
import { SCHEMA_VERSION } from "./generated/version";

export const DEFAULT_BASE_URL = "https://szum.io";
export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_MAX_RETRIES = 2;

export const resolveConfig = (config: ChartConfig): ChartConfigInput =>
  ({
    ...config,
    version: config.version ?? SCHEMA_VERSION,
  }) as ChartConfigInput;

export const assertTransportOptions = ({
  timeout,
  maxRetries,
}: {
  timeout?: number;
  maxRetries?: number;
}): void => {
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new Error("timeout must be a positive number");
  }

  if (
    maxRetries !== undefined &&
    (!Number.isInteger(maxRetries) || maxRetries < 0)
  ) {
    throw new Error("maxRetries must be a non-negative integer");
  }
};
