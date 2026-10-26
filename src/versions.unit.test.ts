import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Szum } from "./client";
import { SzumAPIError, SzumError, SzumInvalidRequestError } from "./errors";
import type { ChartDocumentInput } from "./generated/document";
import { SCHEMA_VERSION } from "./generated/version";

const BASE_URL = "https://test.szum.io";
const DOCUMENT = {
  version: SCHEMA_VERSION,
  config: {
    version: SCHEMA_VERSION,
    type: "column",
    category: { field: "quarter" },
    values: { type: "long", field: "units" },
  },
  data: [{ quarter: "Q1", units: 42 }],
} satisfies ChartDocumentInput;
const VALIDATION = { valid: true, diagnostics: [] };
const CHART = {
  id: "abc123",
  source: "api",
  title: "Quarterly revenue",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  sizeBytes: 412,
  publishedAt: "2026-10-26T00:00:00.000Z",
  imageUrl: "https://szum.io/c/abc123",
  embedUrl: "https://szum.io/e/abc123",
  documentUrl: "https://szum.io/api/charts/abc123/document",
};
const VERSION_WIRE = {
  id: "version-2",
  number: 2,
  kind: "restore",
  eventEvidence: "recorded",
  publishedAt: "2026-10-26T00:00:00.000Z",
  publishedByUserId: "user-1",
  publishedByName: "Anna",
  credential: "oauth",
  apiKeyId: null,
  apiKeyName: null,
  mcpClientId: "client-1",
  mcpClientName: "Claude",
  client: "mcp",
  baseVersion: { id: "version-1", number: 1 },
  restoredFromVersion: { id: "version-1", number: 1 },
  changedSections: ["data"],
  title: "Quarterly revenue",
  sharedThemeId: null,
  publishedRuleFacts: null,
  derivedFacts: { state: "pending" },
  label: "Launch",
  labelledByUserId: "user-1",
  labelledAt: "2026-10-26T00:00:00.000Z",
  removal: null,
  sizeBytes: 412,
  isCurrent: true,
};
const VERSION = {
  id: "version-2",
  number: 2,
  kind: "restore",
  publishedAt: "2026-10-26T00:00:00.000Z",
  publishedByUserId: "user-1",
  publishedByName: "Anna",
  client: "mcp",
  apiKeyName: null,
  mcpClientName: "Claude",
  baseVersion: { id: "version-1", number: 1 },
  restoredFromVersion: { id: "version-1", number: 1 },
  changedSections: ["data"],
  title: "Quarterly revenue",
  label: "Launch",
  removal: null,
  sizeBytes: 412,
  isCurrent: true,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const respond = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
};

const szum = (): Szum => {
  return new Szum({ apiKey: "sk_test", baseUrl: BASE_URL, maxRetries: 0 });
};

const lastRequest = (): { url: string; init: RequestInit } => {
  const call = fetchMock.mock.calls.at(-1);

  if (!call) {
    throw new Error("Expected a request");
  }

  return { url: String(call[0]), init: call[1] ?? {} };
};

describe("charts.update", () => {
  it("sends the client making the update", async () => {
    respond(CHART);

    await szum().charts.update("abc123", DOCUMENT, { source: "figma" });

    expect(JSON.parse(String(lastRequest().init.body))).toEqual({
      document: DOCUMENT,
      source: "figma",
    });
  });
});

describe("charts.versions.list", () => {
  it("reads a page of versions newest first", async () => {
    respond({
      currentVersion: { id: "version-2", number: 2 },
      items: [VERSION_WIRE],
      nextCursor: "older",
    });

    const page = await szum().charts.versions.list("abc123", {
      named: true,
      limit: 1,
      cursor: "newer",
    });

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/charts/abc123/versions?named=1&cursor=newer&limit=1`,
    );
    expect(lastRequest().init.method).toBe("GET");
    expect(page).toEqual({
      currentVersion: { id: "version-2", number: 2 },
      items: [VERSION],
      nextCursor: "older",
    });
  });

  it("keeps a removed version with who published it", async () => {
    respond({
      currentVersion: null,
      items: [
        {
          ...VERSION_WIRE,
          isCurrent: false,
          removal: {
            at: "2026-10-26T01:00:00.000Z",
            reason: "pruned",
            byUserId: null,
            byName: null,
          },
        },
      ],
      nextCursor: null,
    });

    const page = await szum().charts.versions.list("abc123");

    expect(page.items[0]?.removal).toEqual({
      at: "2026-10-26T01:00:00.000Z",
      reason: "pruned",
      byName: null,
    });
    expect(lastRequest().url).toBe(`${BASE_URL}/api/charts/abc123/versions`);
  });

  it.each([
    ["a version without a number", { ...VERSION_WIRE, number: 0 }],
    ["a non-ISO publish time", { ...VERSION_WIRE, publishedAt: "yesterday" }],
    ["sections that aren't strings", { ...VERSION_WIRE, changedSections: [1] }],
    ["a missing current flag", { ...VERSION_WIRE, isCurrent: undefined }],
  ])("rejects %s", async (_case, item) => {
    respond({ currentVersion: null, items: [item], nextCursor: null });

    await expect(szum().charts.versions.list("abc123")).rejects.toBeInstanceOf(
      SzumAPIError,
    );
  });
});

describe("charts.versions.get", () => {
  it("reads a retained version with its preview and restore", async () => {
    respond({
      version: VERSION_WIRE,
      preparation: {
        state: "retained",
        stored: { field: "document", json: "{}" },
        preview: { state: "ready", document: DOCUMENT, validation: VALIDATION },
        restore: {
          state: "ready",
          document: DOCUMENT,
          sharedTheme: { kind: "stored", previousThemeId: null },
          validation: VALIDATION,
          lossCodes: [],
          fingerprint: "fingerprint-1",
        },
      },
    });

    const detail = await szum().charts.versions.get("abc123", 2);

    expect(lastRequest().url).toBe(`${BASE_URL}/api/charts/abc123/versions/2`);
    expect(detail).toEqual({
      version: VERSION,
      preparation: {
        state: "retained",
        preview: { state: "ready", document: DOCUMENT, validation: VALIDATION },
        restore: {
          state: "ready",
          document: DOCUMENT,
          validation: VALIDATION,
          lossCodes: [],
          fingerprint: "fingerprint-1",
        },
      },
    });
  });

  it("reads why a retained version can't be restored", async () => {
    respond({
      version: VERSION_WIRE,
      preparation: {
        state: "retained",
        stored: { field: "document", json: "{}" },
        preview: { state: "blocked", validation: VALIDATION },
        restore: { state: "blocked", reason: "source_pending" },
      },
    });

    const detail = await szum().charts.versions.get("abc123", 2);

    expect(detail.preparation).toEqual({
      state: "retained",
      preview: { state: "blocked", validation: VALIDATION },
      restore: {
        state: "blocked",
        reason: "source_pending",
        document: null,
        validation: null,
        lossCodes: [],
        fingerprint: null,
      },
    });
  });

  it.each([
    [{ state: "removed", reason: "deleted" }],
    [{ state: "unavailable", reason: "transient" }],
  ])("reads a version whose content can't be read: %o", async (preparation) => {
    respond({ version: VERSION_WIRE, preparation });

    const detail = await szum().charts.versions.get("abc123", 2);

    expect(detail.preparation).toEqual(preparation);
  });

  it("rejects a preparation state it doesn't know", async () => {
    respond({ version: VERSION_WIRE, preparation: { state: "archived" } });

    await expect(szum().charts.versions.get("abc123", 2)).rejects.toThrow(
      "preparation.state",
    );
  });
});

describe("charts.versions.restore", () => {
  it("posts the restore options and returns the chart with its version", async () => {
    respond({ ...CHART, currentVersion: { id: "version-3", number: 3 } });

    const chart = await szum().charts.versions.restore("abc123", 1, {
      fingerprint: "fingerprint-1",
      acceptLosses: ["legacy_axis"],
      expectedUpdatedAt: CHART.updatedAt,
      title: "Revenue",
    });

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/charts/abc123/versions/1/restore`,
    );
    expect(lastRequest().init.method).toBe("POST");
    expect(JSON.parse(String(lastRequest().init.body))).toEqual({
      fingerprint: "fingerprint-1",
      acceptLosses: ["legacy_axis"],
      expectedUpdatedAt: CHART.updatedAt,
      title: "Revenue",
    });
    expect(chart).toEqual({
      ...CHART,
      currentVersion: { id: "version-3", number: 3 },
    });
  });

  it("sends an empty object without options", async () => {
    respond({ ...CHART, currentVersion: { id: "version-3", number: 3 } });

    await szum().charts.versions.restore("abc123", 1);

    expect(lastRequest().init.body).toBe("{}");
  });

  it("surfaces a conflict as a SzumError", async () => {
    respond(
      {
        error: {
          code: "conflict",
          message: "Chart has unpublished Studio changes.",
          retryable: false,
        },
      },
      409,
    );

    const error: unknown = await szum()
      .charts.versions.restore("abc123", 1)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SzumError);
    expect(error).toMatchObject({ status: 409 });
  });
});

describe("charts.versions.duplicate", () => {
  it("creates a chart with a generated idempotency key", async () => {
    respond({ ...CHART, id: "copy", currentVersion: null }, 201);

    const copy = await szum().charts.versions.duplicate("abc123", 1, {
      title: "Copy",
    });
    const headers = lastRequest().init.headers as Record<string, string>;

    expect(lastRequest().url).toBe(
      `${BASE_URL}/api/charts/abc123/versions/1/duplicate`,
    );
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(lastRequest().init.body))).toEqual({
      title: "Copy",
    });
    expect(copy).toMatchObject({ id: "copy", currentVersion: null });
  });

  it("uses the idempotency key it is given", async () => {
    respond({ ...CHART, currentVersion: null }, 201);

    await szum().charts.versions.duplicate("abc123", 1, {
      idempotencyKey: "copy-once",
    });

    expect(
      (lastRequest().init.headers as Record<string, string>)["Idempotency-Key"],
    ).toBe("copy-once");
  });
});

describe("charts.versions.name", () => {
  it.each(["Launch", null])("sets the name %s", async (label) => {
    respond({ ok: true, label });

    await expect(szum().charts.versions.name("abc123", 2, label)).resolves.toBe(
      label,
    );
    expect(lastRequest().init.method).toBe("PATCH");
    expect(JSON.parse(String(lastRequest().init.body))).toEqual({ label });
  });
});

describe("charts.versions.delete", () => {
  it("deletes one version", async () => {
    respond({ ok: true, affectedCount: 1 });

    await expect(szum().charts.versions.delete("abc123", 1)).resolves.toEqual({
      affectedCount: 1,
    });
    expect(lastRequest().url).toBe(`${BASE_URL}/api/charts/abc123/versions/1`);
    expect(lastRequest().init.method).toBe("DELETE");
  });

  it("deletes the versions before a number", async () => {
    respond({ ok: true, affectedCount: 3 });

    await expect(
      szum().charts.versions.deleteEarlier("abc123", {
        beforeNumber: 4,
        includeLabelled: false,
      }),
    ).resolves.toEqual({ affectedCount: 3 });
    expect(lastRequest().url).toBe(`${BASE_URL}/api/charts/abc123/versions`);
    expect(JSON.parse(String(lastRequest().init.body))).toEqual({
      beforeNumber: 4,
      includeLabelled: false,
    });
  });

  it("rejects an erasure response without ok", async () => {
    respond({ affectedCount: 1 });

    await expect(
      szum().charts.versions.delete("abc123", 1),
    ).rejects.toBeInstanceOf(SzumAPIError);
  });
});

describe("charts.versions input", () => {
  it.each([
    ["an empty id", () => szum().charts.versions.list("")],
    ["a zero version", () => szum().charts.versions.get("abc123", 0)],
    [
      "a fractional version",
      () => szum().charts.versions.restore("abc123", 1.5),
    ],
    [
      "loss codes that aren't strings",
      () =>
        szum().charts.versions.restore("abc123", 1, {
          acceptLosses: [1] as unknown as string[],
        }),
    ],
    [
      "a missing includeLabelled",
      () =>
        szum().charts.versions.deleteEarlier("abc123", {
          beforeNumber: 2,
        } as { beforeNumber: number; includeLabelled: boolean }),
    ],
    [
      "a numeric name",
      () => szum().charts.versions.name("abc123", 1, 5 as unknown as string),
    ],
  ])("refuses %s before sending", async (_case, call) => {
    await expect(call()).rejects.toBeInstanceOf(SzumInvalidRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
