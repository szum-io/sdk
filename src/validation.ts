import type { ChartConfig } from "./client";
import { parseChartDiagnostics } from "./diagnostics";
import { SzumAPIError } from "./errors";
import type { ChartValidationResult } from "./generated/validation";
import { fetchWithRetry, parseRequestId, USER_AGENT } from "./http";
import {
  parseJsonObject,
  requireArray,
  requireBoolean,
  requireObject,
  requireString,
} from "./json";
import {
  assertTransportOptions,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  resolveConfig,
} from "./options";

export type ValidationOptions = {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
};

export const validateChart = async (
  config: ChartConfig,
  options: ValidationOptions = {},
): Promise<ChartValidationResult> => {
  assertTransportOptions(options);

  const response = await fetchWithRetry(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/validate`,
    {
      method: "POST",
      body: JSON.stringify(resolveConfig(config)),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
    },
    {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      signal: options.signal,
      acceptedStatuses: [400],
      retryMode: "safe",
    },
  );
  const body = await parseJsonObject(response);
  const errors = parseChartDiagnostics(requireArray(body, "errors", response));
  const diagnostics = parseChartDiagnostics(
    requireArray(body, "diagnostics", response),
  );

  if (!errors || !diagnostics) {
    throw invalidValidationResponse(response);
  }

  const suggestedConfig =
    "suggestedConfig" in body
      ? (requireObject(
          body,
          "suggestedConfig",
          response,
        ) as unknown as ChartValidationResult["suggestedConfig"])
      : undefined;

  return {
    valid: requireBoolean(body, "valid", response),
    message: requireString(body, "message", response),
    errors,
    diagnostics,
    ...(suggestedConfig !== undefined ? { suggestedConfig } : {}),
  };
};

const invalidValidationResponse = (response: Response): SzumAPIError =>
  new SzumAPIError({
    message: "Invalid response: malformed chart diagnostics",
    status: response.status,
    requestId: parseRequestId(response),
  });
