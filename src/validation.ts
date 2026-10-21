import type { ChartDocument } from "./contracts";
import { createSzumError, SzumAPIError } from "./errors";
import type { ChartValidationResult } from "./generated/validation";
import { fetchWithRetry, parseRequestId, USER_AGENT } from "./http";
import { parseJsonObject } from "./json";
import {
  assertTransportOptions,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  resolveDocument,
  resolveBaseUrl,
} from "./options";
import { parseApiFailure, parseValidationResult } from "./response-documents";

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
  const failure = parseApiFailure(body);

  if (failure) {
    throw createSzumError({
      message: failure.error.message,
      status: response.status,
      requestId: parseRequestId(response),
      failure,
    });
  }

  const result = parseValidationResult(body);

  if (!result) {
    throw invalidValidationResponse(response);
  }

  return result;
};

const invalidValidationResponse = (response: Response): SzumAPIError =>
  new SzumAPIError({
    message: "Invalid response: malformed chart validation result",
    status: response.status,
    requestId: parseRequestId(response),
  });
