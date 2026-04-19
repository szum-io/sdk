import { describe, expect, it } from "vitest";

import {
  createSzumError,
  SzumAPIError,
  SzumAuthenticationError,
  SzumConnectionError,
  SzumError,
  SzumInvalidRequestError,
  SzumPermissionError,
  SzumRateLimitError,
} from "./errors";

describe("SzumError base class", () => {
  it("extends Error and captures all fields", () => {
    const err = new SzumError({
      message: "boom",
      status: 500,
      retryAfter: 10,
      requestId: "req_abc",
      code: "custom_code",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SzumError);
    expect(err.name).toBe("SzumError");
    expect(err.message).toBe("boom");
    expect(err.status).toBe(500);
    expect(err.retryAfter).toBe(10);
    expect(err.requestId).toBe("req_abc");
    expect(err.code).toBe("custom_code");
  });

  it("defaults retryAfter and requestId to null, code to unknown_error", () => {
    const err = new SzumError({ message: "x", status: 0 });

    expect(err.retryAfter).toBeNull();
    expect(err.requestId).toBeNull();
    expect(err.code).toBe("unknown_error");
  });

  it("serializes via toJSON with all fields", () => {
    const err = new SzumError({
      message: "bad",
      status: 400,
      retryAfter: 5,
      requestId: "req_xyz",
      code: "invalid_request",
    });

    const json = JSON.parse(JSON.stringify(err));

    expect(json).toEqual({
      name: "SzumError",
      code: "invalid_request",
      message: "bad",
      status: 400,
      retryAfter: 5,
      requestId: "req_xyz",
    });
  });
});

describe("SzumError subclasses", () => {
  const cases: {
    Cls: new (p: { message: string; status: number }) => SzumError;
    name: string;
    code: string;
  }[] = [
    {
      Cls: SzumAuthenticationError,
      name: "SzumAuthenticationError",
      code: "authentication_error",
    },
    {
      Cls: SzumPermissionError,
      name: "SzumPermissionError",
      code: "permission_error",
    },
    {
      Cls: SzumInvalidRequestError,
      name: "SzumInvalidRequestError",
      code: "invalid_request",
    },
    {
      Cls: SzumRateLimitError,
      name: "SzumRateLimitError",
      code: "rate_limit_exceeded",
    },
    {
      Cls: SzumAPIError,
      name: "SzumAPIError",
      code: "api_error",
    },
    {
      Cls: SzumConnectionError,
      name: "SzumConnectionError",
      code: "connection_error",
    },
  ];

  for (const { Cls, name, code } of cases) {
    it(`${name} sets name, code, and extends SzumError`, () => {
      const err = new Cls({ message: "x", status: 401 });

      expect(err).toBeInstanceOf(SzumError);
      expect(err).toBeInstanceOf(Cls);
      expect(err.name).toBe(name);
      expect(err.code).toBe(code);
    });
  }
});

describe("createSzumError factory", () => {
  it("maps status 0 to SzumConnectionError", () => {
    const err = createSzumError({ message: "x", status: 0 });
    expect(err).toBeInstanceOf(SzumConnectionError);
    expect(err.code).toBe("connection_error");
  });

  it("maps 401 to SzumAuthenticationError", () => {
    const err = createSzumError({ message: "x", status: 401 });
    expect(err).toBeInstanceOf(SzumAuthenticationError);
    expect(err.code).toBe("authentication_error");
  });

  it("maps 403 to SzumPermissionError", () => {
    const err = createSzumError({ message: "x", status: 403 });
    expect(err).toBeInstanceOf(SzumPermissionError);
    expect(err.code).toBe("permission_error");
  });

  it("maps 429 to SzumRateLimitError", () => {
    const err = createSzumError({ message: "x", status: 429 });
    expect(err).toBeInstanceOf(SzumRateLimitError);
    expect(err.code).toBe("rate_limit_exceeded");
  });

  it("maps other 4xx to SzumInvalidRequestError", () => {
    for (const status of [400, 404, 413, 422]) {
      const err = createSzumError({ message: "x", status });
      expect(err).toBeInstanceOf(SzumInvalidRequestError);
      expect(err.code).toBe("invalid_request");
    }
  });

  it("maps 5xx to SzumAPIError", () => {
    for (const status of [500, 502, 503, 504]) {
      const err = createSzumError({ message: "x", status });
      expect(err).toBeInstanceOf(SzumAPIError);
      expect(err.code).toBe("api_error");
    }
  });

  it("passes through retryAfter and requestId", () => {
    const err = createSzumError({
      message: "x",
      status: 429,
      retryAfter: 30,
      requestId: "req_42",
    });

    expect(err.retryAfter).toBe(30);
    expect(err.requestId).toBe("req_42");
  });
});
