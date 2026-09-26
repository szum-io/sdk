import type { ChartDocument } from "./contracts";
import { createSzumError, SzumAPIError } from "./errors";
import type { ChartValidationResult } from "./generated/validation";
import {
  isApiFailure,
  isChartValidationResult,
} from "./generated/response-validators.js";
import { fetchWithRetry, parseRequestId, USER_AGENT } from "./http";
import { parseJsonObject } from "./json";
import {
  assertTransportOptions,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  resolveDocument,
  resolveBaseUrl,
} from "./options";

export type ValidationOptions = {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
};

export const validateChart = async (
  chart: ChartDocument,
  options: ValidationOptions = {},
): Promise<ChartValidationResult> => {
  assertTransportOptions(options);

  const response = await fetchWithRetry(
    `${resolveBaseUrl(options.baseUrl)}/validate`,
    {
      method: "POST",
      body: JSON.stringify(resolveDocument(chart)),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
    },
    {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      signal: options.signal,
      acceptedStatuses: [400, 413],
      retryMode: "safe",
    },
  );
  const body = await parseJsonObject(response);

  if (isApiFailure(body)) {
    throw createSzumError({
      message: body.error.message,
      status: response.status,
      requestId: parseRequestId(response),
      failure: body,
    });
  }

  if (!isChartValidationResult(body)) {
    throw invalidValidationResponse(response);
  }

  return body;
};

const invalidValidationResponse = (response: Response): SzumAPIError =>
  new SzumAPIError({
    message: "Invalid response: malformed chart validation result",
    status: response.status,
    requestId: parseRequestId(response),
  });
