import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChartConfig, Szum } from "./client";
import {
  SzumAuthenticationError,
  SzumConnectionError,
  SzumError,
  SzumInvalidRequestError,
  SzumRateLimitError,
} from "./errors";
import { SCHEMA_VERSION } from "./generated/version";

const VALID_CONFIG: ChartConfig = {
  format: "svg",
  marks: [
    {
      type: "barY",
      data: [
        { x: "A", y: 1 },
        { x: "B", y: 2 },
      ],
    },
  ],
};

const createMockResponse = ({
  ok = true,
  status = 200,
  statusText = "OK",
  body,
  headers = {},
}: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
}): Response => {
  const responseHeaders = new Headers(headers);
  const textBody =
    body instanceof ArrayBuffer ? new TextDecoder().decode(body) : (body ?? "");

  return {
    ok,
    status,
    statusText,
    headers: responseHeaders,
    text: vi.fn().mockResolvedValue(textBody),
    json: vi.fn().mockImplementation(async () => {
      return JSON.parse(textBody || "{}");
    }),
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(
        body instanceof ArrayBuffer
          ? body
          : new TextEncoder().encode(textBody).buffer,
      ),
  } as unknown as Response;
};

describe("Szum (unit)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("render", () => {
    it("sends correct method, URL, and headers", async () => {
      const szum = new Szum({
        apiKey: "sk_test_123",
        baseUrl: "https://test.szum.io",
      });
      const svgBytes = new TextEncoder().encode("<svg></svg>");
      fetchMock.mockResolvedValue(
        createMockResponse({ body: svgBytes.buffer as ArrayBuffer }),
      );

      await szum.render(VALID_CONFIG);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/chart");
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk_test_123");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["User-Agent"]).toMatch(/^szum-sdk\//);
    });

    it("injects schema version when not provided", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: new ArrayBuffer(0) }),
      );

      await szum.render(VALID_CONFIG);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.version).toBe(SCHEMA_VERSION);
      expect(body.format).toBe("svg");
      expect(body.marks).toHaveLength(1);
    });

    it("preserves explicit version when provided", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: new ArrayBuffer(0) }),
      );

      await szum.render({ ...VALID_CONFIG, version: "2026-03-20" });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init?.body as string);
      expect(body.version).toBe("2026-03-20");
    });

    it("returns Uint8Array on success", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const svgBytes = new TextEncoder().encode("<svg>chart</svg>");
      fetchMock.mockResolvedValue(
        createMockResponse({ body: svgBytes.buffer as ArrayBuffer }),
      );

      const result = await szum.render(VALID_CONFIG);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(result)).toBe("<svg>chart</svg>");
    });

    it("throws SzumError with JSON error message on failure", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          body: JSON.stringify({
            error: "marks.0.type: Invalid discriminator value",
          }),
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(400);
        expect(szumErr.message).toBe(
          "marks.0.type: Invalid discriminator value",
        );
      }
    });

    it("falls back to text body when error response is not JSON", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        maxRetries: 0,
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          body: "upstream connect error",
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(502);
        expect(szumErr.message).toBe("upstream connect error");
      }
    });

    it("throws SzumInvalidRequestError specifically on 400", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          body: JSON.stringify({ error: "invalid" }),
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(
        SzumInvalidRequestError,
      );
    });

    it("throws SzumAuthenticationError specifically on 401", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          body: JSON.stringify({ error: "bad key" }),
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(
        SzumAuthenticationError,
      );
    });

    it("throws SzumRateLimitError specifically on 429", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        maxRetries: 0,
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          body: JSON.stringify({ error: "slow down" }),
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(
        SzumRateLimitError,
      );
    });

    it("captures x-vercel-id header on error responses", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          body: JSON.stringify({ error: "x" }),
          headers: { "X-Vercel-Id": "fra1::abc123" },
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).requestId).toBe("fra1::abc123");
      }
    });

    it("exposes retryAfter on 429 responses", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        maxRetries: 0,
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          body: JSON.stringify({ error: "Rate limit exceeded" }),
          headers: { "Retry-After": "30" },
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(429);
        expect(szumErr.retryAfter).toBe(30);
      }
    });

    it("sets retryAfter to null when header is absent", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          body: JSON.stringify({ error: "Invalid API key" }),
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).retryAfter).toBeNull();
      }
    });

    it("passes AbortSignal for timeout", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: new ArrayBuffer(0) }),
      );

      await szum.render(VALID_CONFIG);

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("throws SzumError on timeout", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        timeout: 1,
      });

      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      });

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumConnectionError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(0);
        expect(szumErr.message).toMatch(/timed out/);
      }
    });
  });

  describe("signedUrl", () => {
    it("sends correct request to signed-url endpoint", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            url: "https://szum.io/chart?config=...&sig=abc&kid=123",
          }),
        }),
      );

      await szum.signedUrl(VALID_CONFIG);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/signed-url");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.config).toEqual({ ...VALID_CONFIG, version: SCHEMA_VERSION });
    });

    it("returns URL string on success", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const expectedUrl = "https://szum.io/chart?config=abc&sig=xyz&kid=k1";
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ url: expectedUrl }),
        }),
      );

      const result = await szum.signedUrl(VALID_CONFIG);

      expect(result).toBe(expectedUrl);
    });

    it("throws SzumError when response is missing url field", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ something: "else" }),
        }),
      );

      try {
        await szum.signedUrl(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.message).toMatch(/missing.*url/i);
      }
    });

    it("throws SzumError on error response", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          body: JSON.stringify({
            error: "Signed URLs are only available on the Pro plan.",
          }),
        }),
      );

      try {
        await szum.signedUrl(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(403);
        expect(szumErr.message).toContain("Pro plan");
      }
    });
  });

  describe("constructor", () => {
    it("uses default base URL when not provided", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: new ArrayBuffer(0) }),
      );

      await szum.render(VALID_CONFIG);

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://szum.io/chart");
    });

    it("throws when apiKey is empty string", () => {
      expect(() => new Szum({ apiKey: "" })).toThrow(/apiKey is required/);
    });

    it("throws when apiKey is missing (undefined)", () => {
      expect(
        () => new Szum({ apiKey: undefined as unknown as string }),
      ).toThrow(/apiKey is required/);
    });

    it("throws when timeout is zero or negative", () => {
      expect(() => new Szum({ apiKey: "sk_test", timeout: 0 })).toThrow(
        /timeout must be a positive number/,
      );
      expect(() => new Szum({ apiKey: "sk_test", timeout: -100 })).toThrow(
        /timeout must be a positive number/,
      );
    });

    it("throws when maxRetries is negative or non-integer", () => {
      expect(() => new Szum({ apiKey: "sk_test", maxRetries: -1 })).toThrow(
        /maxRetries must be a non-negative integer/,
      );
      expect(() => new Szum({ apiKey: "sk_test", maxRetries: 1.5 })).toThrow(
        /maxRetries must be a non-negative integer/,
      );
    });

    it("accepts maxRetries: 0", () => {
      expect(
        () => new Szum({ apiKey: "sk_test", maxRetries: 0 }),
      ).not.toThrow();
    });

    it("throws when instantiated in a browser-like environment", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("document", {});

      expect(() => new Szum({ apiKey: "sk_test" })).toThrow(/server-side only/);

      vi.unstubAllGlobals();
    });
  });

  describe("per-call options", () => {
    it("uses per-call timeout over client timeout", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        timeout: 30_000,
      });

      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      });

      try {
        await szum.render(VALID_CONFIG, { timeout: 1 });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumConnectionError);
        expect((err as SzumError).message).toMatch(/timed out after 1ms/);
      }
    });

    it("respects caller's AbortSignal (passes through original abort)", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      });

      const controller = new AbortController();
      const promise = szum.render(VALID_CONFIG, { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.toThrow(/aborted/i);
      await expect(promise).rejects.not.toBeInstanceOf(SzumConnectionError);
    });
  });

  describe("retry logic", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on 429 and eventually succeeds", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      let callCount = 0;
      fetchMock.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return createMockResponse({
            ok: false,
            status: 429,
            body: JSON.stringify({ error: "slow down" }),
            headers: { "Retry-After": "1" },
          });
        }
        return createMockResponse({ body: new ArrayBuffer(0) });
      });

      const promise = szum.render(VALID_CONFIG);
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(callCount).toBe(3);
    });

    it("retries on 502 with backoff", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      let callCount = 0;
      fetchMock.mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          return createMockResponse({
            ok: false,
            status: 502,
            body: "bad gateway",
          });
        }
        return createMockResponse({ body: new ArrayBuffer(0) });
      });

      const promise = szum.render(VALID_CONFIG);
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(callCount).toBe(2);
    });

    it("retries on 503 and 504 too", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      const statuses = [503, 504];
      let idx = 0;
      fetchMock.mockImplementation(async () => {
        if (idx < statuses.length) {
          const status = statuses[idx++];
          return createMockResponse({
            ok: false,
            status,
            body: "transient",
          });
        }
        return createMockResponse({ body: new ArrayBuffer(0) });
      });

      const promise = szum.render(VALID_CONFIG);
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(idx).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry 500", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          body: "render failed",
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(SzumError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry 401", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          body: JSON.stringify({ error: "bad key" }),
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(SzumError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws last error after exhausting retries", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 503,
          body: "still down",
        }),
      );

      const promise = szum.render(VALID_CONFIG);
      const expectation = expect(promise).rejects.toBeInstanceOf(SzumError);
      await vi.advanceTimersByTimeAsync(60_000);
      await expectation;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("maxRetries: 0 disables retries", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
        maxRetries: 0,
      });

      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 503,
          body: "down",
        }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(SzumError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("honors Retry-After for 429 delay", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      let callCount = 0;
      fetchMock.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return createMockResponse({
            ok: false,
            status: 429,
            body: "",
            headers: { "Retry-After": "5" },
          });
        }
        return createMockResponse({ body: new ArrayBuffer(0) });
      });

      const promise = szum.render(VALID_CONFIG);

      await vi.advanceTimersByTimeAsync(4_000);
      expect(callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(2_000);
      await promise;
      expect(callCount).toBe(2);
    });
  });
});
