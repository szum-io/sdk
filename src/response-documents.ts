import type { ChartDocumentInput } from "./generated/document";
import type { ApiFailure } from "./generated/failure";
import {
  isApiFailure,
  isChartValidationResult,
} from "./generated/response-validators.js";
import type { ChartValidationResult } from "./generated/validation";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isResponseDocument = (
  value: unknown,
): value is ChartDocumentInput =>
  isRecord(value) &&
  typeof value.version === "string" &&
  Array.isArray(value.data) &&
  isRecord(value.config) &&
  value.config.version === value.version &&
  typeof value.config.type === "string";

export const parseApiFailure = (body: unknown): ApiFailure | null => {
  if (!isRecord(body)) {
    return null;
  }

  const { suggestedDocument, ...failure } = body;

  if (!isApiFailure(failure) || !isOptionalDocument(suggestedDocument)) {
    return null;
  }

  return suggestedDocument === undefined
    ? failure
    : { ...failure, suggestedDocument };
};

export const parseValidationResult = (
  body: Record<string, unknown>,
): ChartValidationResult | null => {
  const { suggestedDocument, ...result } = body;

  if (!isChartValidationResult(result) || !isOptionalDocument(suggestedDocument)) {
    return null;
  }

  return suggestedDocument === undefined
    ? result
    : { ...result, suggestedDocument };
};

const isOptionalDocument = (
  value: unknown,
): value is ChartDocumentInput | undefined =>
  value === undefined || isResponseDocument(value);
