type SzumErrorParams = {
  message: string;
  status: number;
  retryAfter?: number | null;
  requestId?: string | null;
  code?: string;
};

type SzumSubclassParams = Omit<SzumErrorParams, "code">;

export class SzumError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | null;
  readonly requestId: string | null;

  constructor({
    message,
    status,
    retryAfter,
    requestId,
    code,
  }: SzumErrorParams) {
    super(message);
    this.name = "SzumError";
    this.code = code ?? "unknown_error";
    this.status = status;
    this.retryAfter = retryAfter ?? null;
    this.requestId = requestId ?? null;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      retryAfter: this.retryAfter,
      requestId: this.requestId,
    };
  }
}

export class SzumAuthenticationError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "authentication_error" });
    this.name = "SzumAuthenticationError";
  }
}

export class SzumPermissionError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "permission_error" });
    this.name = "SzumPermissionError";
  }
}

export class SzumInvalidRequestError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "invalid_request" });
    this.name = "SzumInvalidRequestError";
  }
}

export class SzumRateLimitError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "rate_limit_exceeded" });
    this.name = "SzumRateLimitError";
  }
}

export class SzumAPIError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "api_error" });
    this.name = "SzumAPIError";
  }
}

export class SzumConnectionError extends SzumError {
  constructor(params: SzumSubclassParams) {
    super({ ...params, code: "connection_error" });
    this.name = "SzumConnectionError";
  }
}

export const createSzumError = (params: SzumSubclassParams): SzumError => {
  const { status } = params;

  if (status === 0) {
    return new SzumConnectionError(params);
  }

  if (status === 401) {
    return new SzumAuthenticationError(params);
  }

  if (status === 403) {
    return new SzumPermissionError(params);
  }

  if (status === 429) {
    return new SzumRateLimitError(params);
  }

  if (status >= 400 && status < 500) {
    return new SzumInvalidRequestError(params);
  }

  if (status >= 500) {
    return new SzumAPIError(params);
  }

  return new SzumError(params);
};
