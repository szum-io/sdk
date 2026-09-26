import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Szum } from "./client";
import type { ChartConfig, ChartDocument } from "./index";
import { SzumError } from "./errors";
import { SCHEMA_VERSION } from "./generated/version";
import { integrationEnvironmentProblem } from "./integration-policy";
import { validateChart } from "./validation";

const BASE_URL = process.env.SZUM_BASE_URL ?? "";
const API_KEY = process.env.SZUM_API_KEY ?? "";
const LIFECYCLE_TIMEOUT_MS = 45_000;

const createdIds = new Set<string>();

beforeAll(() => {
  const problem = integrationEnvironmentProblem({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  if (problem !== null) {
    throw new Error(problem);
  }
});

afterEach(async () => {
  if (createdIds.size === 0) {
    return;
  }

  const client = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

  for (const id of createdIds) {
    await client.charts.delete(id);
    createdIds.delete(id);
  }
});

const VALID_CONFIG: ChartConfig = {
  type: "column",
  category: { field: "category" },
  values: { type: "long", field: "value" },
};

const VALID_DATA = [
  { category: "A", value: 1 },
  { category: "B", value: 2 },
];

const VALID_DOCUMENT: ChartDocument = {
  config: VALID_CONFIG,
  data: VALID_DATA,
  output: { format: "svg" },
};

describe("Szum (staging integration)", () => {
  it(
    "validates anonymously and exercises the complete saved-document lifecycle",
    async () => {
      const client = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const validation = await validateChart(VALID_DOCUMENT, {
        baseUrl: BASE_URL,
      });
      expect(validation.valid).toBe(true);
      const title = `SDK release check ${crypto.randomUUID()}`;
      const created = await client.charts.create(VALID_DOCUMENT, { title });
      createdIds.add(created.id);
      expect(await client.charts.get(created.id)).toEqual(created);
      const page = await client.charts.list({
        q: title,
        source: "api",
        limit: 1,
      });
      expect(page.items.map(({ id }) => id)).toEqual([created.id]);
      expect(page.total).toBe(1);
      const state = await client.charts.getDocumentState(created.id);
      expect(state.document).toMatchObject({
        version: SCHEMA_VERSION,
        data: VALID_DATA,
      });
      expect(state.draft).toBeNull();
      const missingId = crypto.randomUUID().replaceAll("-", "");
      const batch = await client.charts.getDocuments([created.id, missingId]);
      expect(batch.documents.map(({ id }) => id)).toEqual([created.id]);
      expect(batch.missing).toEqual([{ id: missingId, reason: "not_found" }]);
      const renamed = await client.charts.rename(
        created.id,
        `${title} renamed`,
      );
      expect(renamed.title).toBe(`${title} renamed`);
      const data = [{ category: "Updated", value: 9 }];
      const updated = await client.charts.update(created.id, {
        ...VALID_DOCUMENT,
        data,
      });
      expect(updated.imageUrl).toBe(created.imageUrl);
      expect(updated.embedUrl).toBe(created.embedUrl);
      expect(
        (await client.charts.getDocumentState(created.id)).document?.data,
      ).toEqual(data);
      await client.charts.delete(created.id);
      await client.charts.delete(created.id);
      createdIds.delete(created.id);
      await expect(client.charts.get(created.id)).rejects.toMatchObject({
        status: 404,
      });
    },
    LIFECYCLE_TIMEOUT_MS,
  );

  describe("render", () => {
    it("returns SVG bytes for a valid document", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const {
        data: result,
        contentType,
        usage,
        fontFallback,
      } = await szum.renderWithMetadata(VALID_DOCUMENT);
      expect(contentType).toContain("image/svg+xml");
      expect(usage.used).toBeGreaterThanOrEqual(0);
      expect(typeof fontFallback).toBe("boolean");

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBeGreaterThan(0);

      const text = new TextDecoder().decode(result);
      expect(text).toContain("<svg");
    });

    it("returns PNG bytes for a valid document", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const result = await szum.render({
        ...VALID_DOCUMENT,
        output: { format: "png" },
      });

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBeGreaterThan(0);

      const header = result.slice(0, 4);
      expect(header).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    });

    it("throws SzumError on an invalid document", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

      try {
        await szum.render({
          ...VALID_DOCUMENT,
          config: {
            ...VALID_CONFIG,
            // @ts-expect-error testing invalid discriminator value
            type: "invalid",
          },
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(400);
      }
    });

    it("throws SzumError on invalid API key", async () => {
      const bad = new Szum({ apiKey: "sk_bad", baseUrl: BASE_URL });

      try {
        await bad.render(VALID_DOCUMENT);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(401);
      }
    });
  });

  describe("charts.create", () => {
    it("returns the chart object for a valid document", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const result = await szum.charts.create(VALID_DOCUMENT);
      createdIds.add(result.id);

      expect(typeof result.imageUrl).toBe("string");
      expect(result.imageUrl).toMatch(/^https?:\/\//);
      expect(result.imageUrl).toContain("/c/");
      expect(typeof result.embedUrl).toBe("string");
      expect(result.embedUrl).toMatch(/^https?:\/\//);
      expect(result.embedUrl).toContain("/e/");
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
    });

    it("throws SzumError on an invalid document", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

      try {
        await szum.charts.create({
          ...VALID_DOCUMENT,
          config: {
            ...VALID_CONFIG,
            // @ts-expect-error testing invalid discriminator value
            type: "invalid",
          },
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(400);
      }
    });

    it("throws SzumError on invalid API key", async () => {
      const bad = new Szum({ apiKey: "sk_bad", baseUrl: BASE_URL });

      try {
        await bad.charts.create(VALID_DOCUMENT);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(401);
      }
    });
  });

  describe("charts.delete", () => {
    it("creates a chart and then deletes it by id", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const created = await szum.charts.create(VALID_DOCUMENT);
      createdIds.add(created.id);
      await szum.charts.delete(created.id);
      await szum.charts.delete(created.id);
    });

    it("throws SzumError on invalid API key", async () => {
      const bad = new Szum({ apiKey: "sk_bad", baseUrl: BASE_URL });

      try {
        await bad.charts.delete("abc123");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(401);
      }
    });
  });
});
