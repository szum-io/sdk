import type { SavedChart, SavedChartSource } from "./generated/saved-charts";
import type { ChartDocumentInput } from "./generated/document";
import { SzumAPIError, SzumInvalidRequestError } from "./errors";
import { parseRequestId } from "./http";
import {
  requireNonnegativeInteger,
  requireString,
  requireStringOrNull,
} from "./json";
import { isResponseDocument } from "./response-documents";

export const assertId = (id: string): void => {
  if (typeof id !== "string" || id.length === 0) {
    throw new SzumInvalidRequestError({
      message: "id must be a non-empty string",
      status: 0,
    });
  }
};

// imageUrl/embedUrl/id are parsed first so a malformed response reports the
// most recognizable missing field.
export const parseSavedChart = (
  response: Response,
  obj: Record<string, unknown>,
): SavedChart => {
  const imageUrl = requireString(obj, "imageUrl", response);
  const embedUrl = requireString(obj, "embedUrl", response);
  const id = requireString(obj, "id", response);
  const source = requireString(obj, "source", response) as SavedChartSource;
  const title = requireString(obj, "title", response);
  const createdAt = requireString(obj, "createdAt", response);
  const updatedAt = requireString(obj, "updatedAt", response);
  const sizeBytes = requireNonnegativeInteger(obj, "sizeBytes", response);
  const publishedAt = requireStringOrNull(obj, "publishedAt", response);
  const documentUrl = requireString(obj, "documentUrl", response);

  assertIsoTimestamp(response, "createdAt", createdAt);
  assertIsoTimestamp(response, "updatedAt", updatedAt);

  if (publishedAt !== null) {
    assertIsoTimestamp(response, "publishedAt", publishedAt);
  }

  assertAbsoluteUrl(response, "imageUrl", imageUrl);
  assertAbsoluteUrl(response, "embedUrl", embedUrl);
  assertAbsoluteUrl(response, "documentUrl", documentUrl);

  return {
    id,
    source,
    title,
    createdAt,
    updatedAt,
    sizeBytes,
    publishedAt,
    imageUrl,
    embedUrl,
    documentUrl,
  };
};

export const parseDocument = (
  value: unknown,
  response: Response,
): ChartDocumentInput => {
  if (!isResponseDocument(value)) {
    throw invalidResponseField(response, "document");
  }

  return value;
};

export const assertIsoTimestamp = (
  response: Response,
  field: string,
  value: string,
): void => {
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw invalidResponseField(response, field);
  }
};

const assertAbsoluteUrl = (
  response: Response,
  field: string,
  value: string,
): void => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw invalidResponseField(response, field);
    }
  } catch {
    throw invalidResponseField(response, field);
  }
};

export const invalidResponseField = (
  response: Response,
  field: string,
): SzumAPIError =>
  new SzumAPIError({
    message: `Invalid response: missing or invalid '${field}' field`,
    status: response.status,
    requestId: parseRequestId(response),
  });
