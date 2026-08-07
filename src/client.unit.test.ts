import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ChartConfig, Szum } from "./client";
import {
  SzumAPIError,
  SzumAuthenticationError,
  SzumConnectionError,
  SzumError,
  SzumInvalidRequestError,
  SzumRateLimitError,
} from "./errors";
import { SCHEMA_VERSION } from "./generated/version";
import { validateChart } from "./validation";

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

const CHART_OBJECT = {
  id: "abc123",
  source: "api",
  title: "Quarterly revenue",
  createdAt: "2024-06-01T00:00:00.000Z",
  updatedAt: "2024-06-08T00:00:00.000Z",
  sizeBytes: 412,
  publishedAt: "2024-06-01T00:00:00.000Z",
  imageUrl: "https://szum.io/c/abc123",
  embedUrl: "https://szum.io/e/abc123",
  configUrl: "https://szum.io/api/charts/abc123/config",
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

    it("returns render bytes and response metadata", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const svgBytes = new TextEncoder().encode("<svg>chart</svg>");
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: svgBytes.buffer as ArrayBuffer,
          headers: {
            "Content-Type": "image/svg+xml",
            "X-Font-Fallback": "true",
            "X-Usage-Used": "12",
            "X-Usage-Limit": "500",
            "X-Usage-Remaining": "488",
          },
        }),
      );

      const result = await szum.renderWithMetadata(VALID_CONFIG);

      expect(new TextDecoder().decode(result.data)).toBe("<svg>chart</svg>");
      expect(result).toMatchObject({
        contentType: "image/svg+xml",
        fontFallback: true,
        usage: { used: 12, limit: 500, remaining: 488, overage: false },
      });
    });

    it("rejects incomplete render metadata", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: new ArrayBuffer(0),
          headers: { "Content-Type": "image/svg+xml" },
        }),
      );

      await expect(
        szum.renderWithMetadata(VALID_CONFIG),
      ).rejects.toBeInstanceOf(SzumAPIError);
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

    it("preserves structured chart issues on errors", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const issue = {
        code: "schema_invalid",
        severity: "error",
        path: ["marks", 0],
        message: "Invalid mark",
        details: {},
      };
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          body: JSON.stringify({ error: "Invalid config", issues: [issue] }),
        }),
      );

      try {
        await szum.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SzumError);
        expect((error as SzumError).issues).toEqual([issue]);
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

  describe("charts.create", () => {
    it("sends correct request to /api/charts", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.create(VALID_CONFIG);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.config).toEqual({ ...VALID_CONFIG, version: SCHEMA_VERSION });
    });

    it("sends an explicit saved-chart title", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.create(VALID_CONFIG, { title: "API revenue" });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init?.body as string).title).toBe("API revenue");
    });

    it("returns the chart object on success", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      const result = await szum.charts.create(VALID_CONFIG);

      expect(result).toEqual(CHART_OBJECT);
    });

    it("attaches an auto-generated Idempotency-Key", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.create(VALID_CONFIG);

      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(typeof headers["Idempotency-Key"]).toBe("string");
      expect(headers["Idempotency-Key"].length).toBeGreaterThan(0);
    });

    it("uses a caller-provided idempotencyKey", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.create(VALID_CONFIG, { idempotencyKey: "key-123" });

      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("key-123");
    });

    it("generates a distinct Idempotency-Key per call (no false dedupe)", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.create(VALID_CONFIG);
      await szum.charts.create(VALID_CONFIG);

      const headersFor = (i: number) =>
        fetchMock.mock.calls[i][1]?.headers as Record<string, string>;
      expect(headersFor(0)["Idempotency-Key"]).not.toBe(
        headersFor(1)["Idempotency-Key"],
      );
    });

    it("throws SzumAPIError when response is missing 'imageUrl'", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            embedUrl: "https://szum.io/e/abc123",
            id: "abc123",
          }),
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumAPIError);
        expect((err as SzumError).message).toMatch(/missing 'imageUrl'/);
      }
    });

    it("throws SzumAPIError when response is missing 'embedUrl'", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            imageUrl: "https://szum.io/c/abc123",
            id: "abc123",
          }),
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumAPIError);
        expect((err as SzumError).message).toMatch(/missing 'embedUrl'/);
      }
    });

    it("throws SzumAPIError when response is missing 'id'", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            imageUrl: "https://szum.io/c/abc123",
            embedUrl: "https://szum.io/e/abc123",
          }),
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumAPIError);
        expect((err as SzumError).message).toMatch(/missing 'id'/);
      }
    });

    it("throws SzumAPIError when success body is not JSON", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: "<html>upstream error</html>",
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumAPIError);
        expect((err as SzumError).message).toMatch(/expected JSON body/);
      }
    });

    it("throws SzumAPIError when success body is not a JSON object", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify(["a", "b"]),
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumAPIError);
        expect((err as SzumError).message).toMatch(/expected JSON object/);
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
            error: "Saved charts are only available on the Pro plan.",
          }),
        }),
      );

      try {
        await szum.charts.create(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        const szumErr = err as SzumError;
        expect(szumErr.status).toBe(403);
        expect(szumErr.message).toContain("Pro plan");
      }
    });
  });

  describe("validateChart", () => {
    it("uses the anonymous validation endpoint and returns diagnostics", async () => {
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            valid: true,
            message: "Valid chart config",
            errors: [],
            diagnostics: [],
          }),
        }),
      );

      const result = await validateChart(VALID_CONFIG, {
        baseUrl: "https://test.szum.io",
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/validate");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        undefined,
      );
      expect(result).toEqual({
        valid: true,
        message: "Valid chart config",
        errors: [],
        diagnostics: [],
      });
    });

    it("returns a structured invalid result from HTTP 400", async () => {
      const issue = {
        code: "schema_invalid",
        severity: "error",
        path: [],
        message: "Invalid config",
        details: {},
      };
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 400,
          body: JSON.stringify({
            valid: false,
            message: "Invalid config",
            errors: [issue],
            diagnostics: [issue],
          }),
        }),
      );

      await expect(
        validateChart(VALID_CONFIG, { baseUrl: "https://test.szum.io" }),
      ).resolves.toMatchObject({ valid: false, errors: [issue] });
    });
  });

  describe("charts.delete", () => {
    it("sends DELETE to /api/charts/{id}", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify({ ok: true }) }),
      );

      await szum.charts.delete("abc123");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc123");
      expect(init?.method).toBe("DELETE");
    });

    it("URL-encodes the id", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify({ ok: true }) }),
      );

      await szum.charts.delete("abc/../def");

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc%2F..%2Fdef");
    });

    it("throws SzumInvalidRequestError when id is empty", async () => {
      const szum = new Szum({ apiKey: "sk_test" });

      try {
        await szum.charts.delete("");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumInvalidRequestError);
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).message).toMatch(/non-empty/);
        expect((err as SzumError).status).toBe(0);
      }
    });

    it("resolves on 404 (idempotent delete)", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: "Not Found",
          body: JSON.stringify({ error: "Chart not found." }),
        }),
      );

      await expect(szum.charts.delete("abc123")).resolves.toBeUndefined();
    });

    it("still throws on non-404 errors", async () => {
      const szum = new Szum({ apiKey: "sk_test", maxRetries: 0 });
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          body: JSON.stringify({ error: "boom" }),
        }),
      );

      await expect(szum.charts.delete("abc123")).rejects.toBeInstanceOf(
        SzumError,
      );
    });
  });

  describe("charts.get", () => {
    it("GETs /api/charts/{id} and returns the chart object", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      const result = await szum.charts.get("abc123");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc123");
      expect(init?.method).toBe("GET");
      expect(result).toEqual(CHART_OBJECT);
    });

    it("throws SzumInvalidRequestError when id is empty", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      await expect(szum.charts.get("")).rejects.toBeInstanceOf(
        SzumInvalidRequestError,
      );
    });
  });

  describe("charts.getConfig", () => {
    it("GETs /api/charts/{id}/config and returns the config", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const config = { version: SCHEMA_VERSION, marks: [] };
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            config,
            draft: null,
            publishedAt: "2024-06-01T00:00:00.000Z",
            title: "Quarterly revenue",
          }),
        }),
      );

      const result = await szum.charts.getConfig("abc123");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc123/config");
      expect(init?.method).toBe("GET");
      expect(result).toEqual(config);
    });

    it("preserves the owner document and draft-only state", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const draft = { version: SCHEMA_VERSION, marks: [] };
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            config: null,
            draft,
            publishedAt: null,
            title: "Draft chart",
          }),
        }),
      );

      await expect(szum.charts.getDocument("abc123")).resolves.toEqual({
        config: null,
        draft,
        publishedAt: null,
        title: "Draft chart",
      });
    });

    it("throws SzumAPIError when 'config' is missing", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify({}) }),
      );

      await expect(szum.charts.getConfig("abc123")).rejects.toBeInstanceOf(
        SzumAPIError,
      );
    });
  });

  describe("charts.getConfigs", () => {
    it("GETs /api/charts/configs?ids=… and returns the configs", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      const config = { version: SCHEMA_VERSION, marks: [] };
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            configs: [
              { id: "a", config },
              { id: "b", config },
            ],
            missing: [{ id: "c", reason: "not_found" }],
          }),
        }),
      );

      const result = await szum.charts.getConfigs(["a", "b", "c"]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/configs?ids=a%2Cb%2Cc");
      expect(init?.method).toBe("GET");
      expect(result).toEqual({
        configs: [
          { id: "a", config },
          { id: "b", config },
        ],
        missing: [{ id: "c", reason: "not_found" }],
      });
    });

    it("forwards an unfamiliar missing reason instead of coercing it", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            configs: [],
            missing: [
              { id: "c", reason: "rate_limited" },
              { id: "d", reason: "unavailable" },
            ],
          }),
        }),
      );

      const result = await szum.charts.getConfigs(["c", "d"]);

      expect(result.missing).toEqual([
        { id: "c", reason: "rate_limited" },
        { id: "d", reason: "unavailable" },
      ]);
    });

    it("rejects a malformed missing reason", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            configs: [],
            missing: [{ id: "c" }, { id: "d", reason: 42 }],
          }),
        }),
      );

      await expect(szum.charts.getConfigs(["c", "d"])).rejects.toBeInstanceOf(
        SzumAPIError,
      );
    });

    it("throws SzumInvalidRequestError when ids is empty", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      await expect(szum.charts.getConfigs([])).rejects.toBeInstanceOf(
        SzumInvalidRequestError,
      );
    });
  });

  describe("charts.update", () => {
    it("PUTs the config to /api/charts/{id}/config and returns the chart object", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      const result = await szum.charts.update("abc123", VALID_CONFIG);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc123/config");
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(init?.body as string);
      expect(body.config).toEqual({ ...VALID_CONFIG, version: SCHEMA_VERSION });
      expect(result).toEqual(CHART_OBJECT);
    });

    it("throws SzumInvalidRequestError when id is empty", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      await expect(szum.charts.update("", VALID_CONFIG)).rejects.toBeInstanceOf(
        SzumInvalidRequestError,
      );
    });
  });

  describe("charts.rename", () => {
    it("PATCHes /api/charts/{id} with the title and returns the chart object", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      const result = await szum.charts.rename("abc123", "New title");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc123");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(init?.body as string)).toEqual({ title: "New title" });
      expect(result).toEqual(CHART_OBJECT);
    });

    it("URL-encodes the id", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
      );

      await szum.charts.rename("abc/../def", "x");

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts/abc%2F..%2Fdef");
    });

    it("throws SzumInvalidRequestError when id is empty", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      await expect(szum.charts.rename("", "x")).rejects.toBeInstanceOf(
        SzumInvalidRequestError,
      );
    });

    it("throws SzumInvalidRequestError when title is not a string", async () => {
      const szum = new Szum({ apiKey: "sk_test" });
      await expect(
        szum.charts.rename("abc123", undefined as unknown as string),
      ).rejects.toBeInstanceOf(SzumInvalidRequestError);
    });
  });

  describe("charts.list", () => {
    it("GETs /api/charts with source + cursor and returns items + nextCursor", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            items: [{ ...CHART_OBJECT, hasDraft: true }],
            nextCursor: "c1",
          }),
        }),
      );

      const result = await szum.charts.list({
        source: "api",
        cursor: "prev",
        limit: 100,
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://test.szum.io/api/charts?source=api&cursor=prev&limit=100",
      );
      expect(init?.method).toBe("GET");
      expect(result.items).toEqual([{ ...CHART_OBJECT, hasDraft: true }]);
      expect(result.nextCursor).toBe("c1");
    });

    it("rejects a list item when the server omits hasDraft", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ items: [CHART_OBJECT], nextCursor: null }),
        }),
      );

      await expect(szum.charts.list()).rejects.toBeInstanceOf(SzumAPIError);
    });

    it("forwards sort and q, and surfaces total when present", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({
            items: [{ ...CHART_OBJECT, hasDraft: false }],
            nextCursor: null,
            total: 1,
          }),
        }),
      );

      const result = await szum.charts.list({ sort: "title", q: "revenue" });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts?sort=title&q=revenue");
      expect(result.total).toBe(1);
    });

    it("omits total when the server does not return it", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ items: [], nextCursor: null }),
        }),
      );

      const result = await szum.charts.list({ source: "api" });

      expect(result).toEqual({ items: [], nextCursor: null });
      expect("total" in result).toBe(false);
    });

    it("joins multiple sources into a comma-separated source param", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ items: [], nextCursor: null }),
        }),
      );

      await szum.charts.list({ source: ["figma", "app"] });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts?source=figma%2Capp");
    });

    it("omits the query string when no params are given", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockResolvedValue(
        createMockResponse({
          body: JSON.stringify({ items: [], nextCursor: null }),
        }),
      );

      const result = await szum.charts.list();

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://test.szum.io/api/charts");
      expect(result).toEqual({ items: [], nextCursor: null });
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

    it("does not retry ambiguous render failures", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });

      fetchMock.mockResolvedValue(
        createMockResponse({ ok: false, status: 502, body: "bad gateway" }),
      );

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(SzumError);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("retries safe reads on 503 and 504", async () => {
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
        return createMockResponse({ body: JSON.stringify(CHART_OBJECT) });
      });

      const promise = szum.charts.get("abc123");
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(idx).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("wraps and retries network errors for safe requests", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(
          createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
        );

      const promise = szum.charts.get("abc123");
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(promise).resolves.toEqual(CHART_OBJECT);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry an ambiguous render network failure", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      await expect(szum.render(VALID_CONFIG)).rejects.toBeInstanceOf(
        SzumConnectionError,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("retries an idempotent create while its key is pending", async () => {
      const szum = new Szum({
        apiKey: "sk_test",
        baseUrl: "https://test.szum.io",
      });
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: false,
            status: 409,
            body: JSON.stringify({ error: "Still processing" }),
            headers: { "Retry-After": "2" },
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({ body: JSON.stringify(CHART_OBJECT) }),
        );

      const promise = szum.charts.create(VALID_CONFIG);
      await vi.advanceTimersByTimeAsync(2_100);

      await expect(promise).resolves.toEqual(CHART_OBJECT);
      expect(fetchMock).toHaveBeenCalledTimes(2);
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

      const promise = szum.charts.get("abc123");
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
