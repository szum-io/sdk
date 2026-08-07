import { SzumAPIError } from "./errors";
import { parseRequestId } from "./http";

export const parseJsonObject = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new SzumAPIError({
      message: `Invalid response: expected JSON body (status ${response.status})`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new SzumAPIError({
      message: `Invalid response: expected JSON object (status ${response.status})`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  return body as Record<string, unknown>;
};

const requireNumber = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): number => {
  const value = obj[key];

  if (typeof value !== "number") {
    throw new SzumAPIError({
      message: `Invalid response: missing '${key}' field`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  return value;
};

export const requireNonnegativeInteger = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): number => {
  const value = requireNumber(obj, key, response);

  if (!Number.isInteger(value) || value < 0) {
    throw invalidField(response, key);
  }

  return value;
};

export const requireObject = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): Record<string, unknown> => {
  const value = obj[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SzumAPIError({
      message: `Invalid response: missing '${key}' field`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  return value as Record<string, unknown>;
};

export const requireRecordValue = (
  value: unknown,
  label: string,
  response: Response,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidField(response, label);
  }

  return value as Record<string, unknown>;
};

export const requireObjectOrNull = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): Record<string, unknown> | null => {
  const value = obj[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalidField(response, key);
  }

  return value as Record<string, unknown>;
};

export const requireArray = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): unknown[] => {
  const value = obj[key];

  if (!Array.isArray(value)) {
    throw invalidField(response, key);
  }

  return value;
};

export const requireBoolean = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): boolean => {
  const value = obj[key];

  if (typeof value !== "boolean") {
    throw invalidField(response, key);
  }

  return value;
};

export const requireString = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): string => {
  const value = obj[key];

  if (typeof value !== "string") {
    throw new SzumAPIError({
      message: `Invalid response: missing '${key}' field`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  return value;
};

export const requireStringOrNull = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): string | null => {
  const value = obj[key];

  if (value !== null && typeof value !== "string") {
    throw new SzumAPIError({
      message: `Invalid response: missing '${key}' field`,
      status: response.status,
      requestId: parseRequestId(response),
    });
  }

  return value;
};

const invalidField = (response: Response, key: string): SzumAPIError =>
  new SzumAPIError({
    message: `Invalid response: missing or invalid '${key}' field`,
    status: response.status,
    requestId: parseRequestId(response),
  });
