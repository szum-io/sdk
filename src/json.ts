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
