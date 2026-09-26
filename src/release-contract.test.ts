import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Szum } from "./client";
import {
  SzumAPIError,
  SzumConnectionError,
  SzumInvalidRequestError,
} from "./errors";
import { SCHEMA_VERSION } from "./generated/version";
import type { ChartDocumentInput } from "./generated/document";
import { isChartDocument } from "./generated/response-validators.js";
import type { Color, ThemeCategoricalColors } from "./generated/types";
import { validateChart } from "./validation";

const document = {
  version: SCHEMA_VERSION,
  config: {
    version: SCHEMA_VERSION,
    type: "column" as const,
    theme: "noir" as const,
    category: { field: "quarter" },
    values: { type: "long" as const, field: "units" },
  },
  data: [{ quarter: "Q1", units: 42 }],
} satisfies ChartDocumentInput;
const validation = {
  valid: true,
  diagnostics: [],
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("complete request lifetime", () => {
  it("preserves operation failure when validation could not run", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Failed to read request body.",
            retryable: false,
          },
        },
        { status: 400 },
      ),
    );
    await expect(validateChart(document)).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
      message: "Failed to read request body.",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("honors a non-retryable failure even when HTTP status normally permits retry", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "limit_reached",
            message: "Resolve the account limit",
            retryable: false,
          },
        },
        { status: 429 },
      ),
    );
    await expect(
      new Szum({ apiKey: "test" }).render(document),
    ).rejects.toMatchObject({ code: "limit_reached", retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects retired validation responses instead of guessing their meaning", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        valid: true,
        message: "Valid chart input",
        errors: [],
        diagnostics: [],
      }),
    );

    await expect(validateChart(document)).rejects.toBeInstanceOf(SzumAPIError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a message for non-contract JSON infrastructure failures", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "upstream timeout" }, { status: 502 }),
    );

    await expect(
      new Szum({ apiKey: "test", maxRetries: 0 }).render(document),
    ).rejects.toMatchObject({
      message: "Request failed with HTTP 502",
      status: 502,
    });
  });

  it("returns render adjustments from image metadata", async () => {
    const diagnostics = [
      {
        code: "render_adjustment",
        severity: "warning",
        path: "/config/labels",
        message: "Two labels suppressed",
        details: {
          reason: "label_collision_suppressed",
          affectedCount: 2,
          labelRoles: ["value"],
        },
      },
    ];
    fetchMock.mockResolvedValue(
      new Response("<svg/>", {
        headers: {
          "Content-Type": "image/svg+xml",
          "X-Chart-Diagnostics": encodeURIComponent(
            JSON.stringify(diagnostics),
          ),
          "X-Usage-Used": "1",
          "X-Usage-Limit": "500",
          "X-Usage-Remaining": "499",
        },
      }),
    );

    const result = await new Szum({ apiKey: "test" }).renderWithMetadata(
      document,
    );
    expect(result.diagnostics).toEqual(diagnostics);
  });
  it("does not fetch when the caller already cancelled", async () => {
    const reason = new Error("already cancelled");
    await expect(
      validateChart(document, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes base URLs consistently for authenticated and anonymous calls", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<svg/>"));
    await new Szum({
      apiKey: "test",
      baseUrl: "https://staging.szum.io/",
    }).render(document);
    expect(fetchMock.mock.calls[0][0]).toBe("https://staging.szum.io/chart");
    fetchMock.mockResolvedValueOnce(Response.json(validation));
    await validateChart(document, { baseUrl: "https://staging.szum.io/" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://staging.szum.io/validate");
  });

  it.each(["a,b", " a", "a "])(
    "rejects ambiguous batch ID %j before serializing the query",
    async (id) => {
      await expect(
        new Szum({ apiKey: "test" }).charts.getDocuments([id]),
      ).rejects.toBeInstanceOf(SzumInvalidRequestError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([200, 400, 429])(
    "times out a stalled body after HTTP %i headers without replaying a render",
    async (status) => {
      fetchMock.mockImplementation(
        async (_, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                );
              },
            }),
            { status },
          ),
      );
      const client = new Szum({ apiKey: "test", timeout: 100 });
      const result = expect(client.render(document)).rejects.toMatchObject({
        message: "Request timed out after 100ms",
        status: 0,
      });
      await vi.advanceTimersByTimeAsync(101);
      await result;
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("wraps a disconnected response body without replaying a billable render", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("connection closed"));
          },
        }),
      ),
    );
    await expect(
      new Szum({ apiKey: "test" }).render(document),
    ).rejects.toBeInstanceOf(SzumConnectionError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves caller cancellation during body reading", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel export");
    fetchMock.mockImplementation(
      async (_, init) =>
        new Response(
          new ReadableStream({
            start(stream) {
              init?.signal?.addEventListener(
                "abort",
                () => stream.error(init.signal?.reason),
                { once: true },
              );
              queueMicrotask(() => controller.abort(reason));
            },
          }),
        ),
    );
    await expect(
      new Szum({ apiKey: "test" }).render(document, {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a safe validation read after its response body disconnects", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("connection closed"));
            },
          }),
        ),
      )
      .mockResolvedValueOnce(Response.json(validation));
    const pending = validateChart(document);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual(validation);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves no caller abort listeners after successful requests and retry waits", async () => {
    const controller = new AbortController();
    fetchMock
      .mockResolvedValueOnce(
        new Response("rate limit", {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockImplementation(async () => Response.json(validation));
    const pending = validateChart(document, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    for (let index = 0; index < 20; index++) {
      await validateChart(document, { signal: controller.signal });
    }
    expect(getEventListeners(controller.signal, "abort")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a retry wait with the caller's exact reason and cleans up", async () => {
    const controller = new AbortController();
    const reason = new Error("stop retrying");
    fetchMock.mockResolvedValue(
      new Response("rate limit", {
        status: 429,
        headers: { "Retry-After": "10" },
      }),
    );
    const result = expect(
      validateChart(document, { signal: controller.signal }),
    ).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(reason);
    await result;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 2_147_483_648])(
    "rejects invalid per-call timeout %s before fetch",
    async (timeout) => {
      await expect(
        new Szum({ apiKey: "test" }).render(document, { timeout }),
      ).rejects.toThrow(/timeout/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("retry identity and server delay", () => {
  it.each(["", " ", "\t", "\r\n"])(
    "rejects a blank create key %j before any retryable write",
    async (idempotencyKey) => {
      await expect(
        new Szum({ apiKey: "test" }).charts.create(document, {
          idempotencyKey,
        }),
      ).rejects.toBeInstanceOf(SzumInvalidRequestError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { header: "0", seconds: 0 },
    { header: "2", seconds: 2 },
    { header: "Tue, 08 Sep 2026 10:00:02 GMT", seconds: 2 },
    { header: "Tue, 08 Sep 2026 09:59:59 GMT", seconds: 0 },
    { header: "Tuesday, 08-Sep-26 10:00:02 GMT", seconds: 2 },
    { header: "Tue Sep  8 10:00:02 2026", seconds: 2 },
    { header: "2oops", seconds: null },
    { header: "-1", seconds: null },
    { header: "1.5", seconds: null },
  ])(
    "decodes Retry-After $header without truncating malformed numbers",
    async ({ header, seconds }) => {
      vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
      fetchMock.mockResolvedValue(
        new Response("limited", {
          status: 429,
          headers: { "Retry-After": header },
        }),
      );
      await expect(
        validateChart(document, { maxRetries: 0 }),
      ).rejects.toMatchObject({ retryAfter: seconds });
    },
  );

  it("does not overflow a long server delay into an immediate retry", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response("limited", {
        status: 429,
        headers: { "Retry-After": "2147484" },
      }),
    );
    const result = expect(
      validateChart(document, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort();
    await result;
  });
});

describe("generated response contracts", () => {
  it("requires a defined member in generated per-scheme color types", () => {
    // @ts-expect-error Empty per-scheme objects are not colors.
    const emptyColor: Color = {};
    // @ts-expect-error Empty per-scheme objects are not palettes.
    const emptyPalette: ThemeCategoricalColors = {};

    for (const colors of [
      { background: emptyColor },
      { categorical: emptyPalette },
    ]) {
      expect(
        isChartDocument({
          ...document,
          config: { ...document.config, themeOverrides: { colors } },
        }),
      ).toBe(false);
    }
  });

  it.each([
    ["two-stop sequential", { sequential: ["#111", "#222"] }, true],
    ["three-stop sequential", { sequential: ["#111", "#222", "#333"] }, true],
    ["one-stop sequential", { sequential: ["#111"] }, false],
    [
      "four-stop sequential",
      { sequential: ["#111", "#222", "#333", "#444"] },
      false,
    ],
    ["three-stop diverging", { diverging: ["#111", "#222", "#333"] }, true],
    [
      "five-stop diverging",
      { diverging: ["#111", "#222", "#333", "#444", "#555"] },
      true,
    ],
    ["two-stop diverging", { diverging: ["#111", "#222"] }, false],
    [
      "four-stop diverging",
      { diverging: ["#111", "#222", "#333", "#444"] },
      false,
    ],
  ] as const)("validates a %s theme range", (_label, colors, accepted) => {
    expect(
      isChartDocument({
        ...document,
        config: {
          ...document.config,
          themeOverrides: { colors },
        },
      }),
    ).toBe(accepted);
  });

  it.each([
    { classification: "exact", lossCodes: [] },
    { classification: "normalized", lossCodes: [] },
    { classification: "lossy", lossCodes: ["tick_density_dropped"] },
    {
      classification: "unsupported",
      lossCodes: [],
      unsupportedCode: "version_unsupported",
    },
  ])(
    "preserves $classification compatibility and the complete suggested document",
    async (compatibility) => {
      const payload = {
        ...validation,
        compatibility,
        suggestedDocument: document,
      };
      fetchMock.mockResolvedValue(Response.json(payload));
      await expect(validateChart(document)).resolves.toEqual(payload);
      expect(document).not.toHaveProperty("presentation");
      expect(document.config).not.toHaveProperty("themeOverrides");
    },
  );

  it.each([
    { classification: "exact", lossCodes: ["loss"] },
    { classification: "normalized", lossCodes: [1] },
    { classification: "lossy", lossCodes: [] },
    { classification: "lossy", lossCodes: [1] },
    { classification: "unsupported", lossCodes: [] },
    { classification: "unknown", lossCodes: [] },
  ])("rejects malformed compatibility %j", async (compatibility) => {
    fetchMock.mockResolvedValue(
      Response.json({ ...validation, compatibility }),
    );
    await expect(validateChart(document)).rejects.toBeInstanceOf(SzumAPIError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["constructor", "toString", "__proto__"])(
    "rejects prototype-name diagnostic severity %s",
    async (severity) => {
      fetchMock.mockResolvedValue(
        Response.json({
          ...validation,
          diagnostics: [
            {
              code: "invalid_structure",
              path: "",
              severity,
              message: "bad",
              details: { reason: "schema_invalid" },
            },
          ],
        }),
      );
      await expect(validateChart(document)).rejects.toBeInstanceOf(
        SzumAPIError,
      );
    },
  );

  it.each([
    {},
    { ...document, version: "2026-03-20" },
    { ...document, data: "bad" },
    { ...document, config: { ...document.config, category: {} } },
  ])(
    "rejects an invalid document at every read boundary: %j",
    async (invalidDocument) => {
      const client = new Szum({ apiKey: "test" });
      fetchMock.mockResolvedValueOnce(
        Response.json({ ...validation, suggestedDocument: invalidDocument }),
      );
      await expect(validateChart(document)).rejects.toBeInstanceOf(
        SzumAPIError,
      );
      fetchMock.mockResolvedValueOnce(
        Response.json({
          document: invalidDocument,
          draft: null,
          publishedAt: null,
          title: "x",
        }),
      );
      await expect(client.charts.getDocumentState("a")).rejects.toBeInstanceOf(
        SzumAPIError,
      );
      fetchMock.mockResolvedValueOnce(
        Response.json({
          document: null,
          draft: invalidDocument,
          publishedAt: null,
          title: "x",
        }),
      );
      await expect(client.charts.getDocumentState("a")).rejects.toBeInstanceOf(
        SzumAPIError,
      );
      fetchMock.mockResolvedValueOnce(
        Response.json({
          documents: [{ id: "a", document: invalidDocument }],
          missing: [],
        }),
      );
      await expect(client.charts.getDocuments(["a"])).rejects.toBeInstanceOf(
        SzumAPIError,
      );
    },
  );

  it.each([
    { documents: [], missing: [] },
    { documents: [{ id: "b", document }], missing: [] },
    {
      documents: [{ id: "a", document }],
      missing: [{ id: "a", reason: "not_found" }],
    },
  ])(
    "rejects incomplete, unrelated or overlapping batch results",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      await expect(
        new Szum({ apiKey: "test" }).charts.getDocuments(["a"]),
      ).rejects.toBeInstanceOf(SzumAPIError);
    },
  );
});
