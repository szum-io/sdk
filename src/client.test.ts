import { describe, expect, it } from "vitest";

import { type ChartConfig, Szum } from "./client";
import { SzumError } from "./errors";

const BASE_URL = process.env.SZUM_BASE_URL ?? "https://szum.io";
const API_KEY = process.env.SZUM_API_KEY ?? "";

const HAS_API_KEY = API_KEY.length > 0;

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

describe.skipIf(!HAS_API_KEY)("Szum (integration)", () => {
  describe("render", () => {
    it("returns SVG bytes for a valid config", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const result = await szum.render(VALID_CONFIG);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBeGreaterThan(0);

      const text = new TextDecoder().decode(result);
      expect(text).toContain("<svg");
    });

    it("returns PNG bytes for a valid config", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const result = await szum.render({
        ...VALID_CONFIG,
        format: "png" as const,
      });

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBeGreaterThan(0);

      const header = result.slice(0, 4);
      expect(header).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    });

    it("throws SzumError on invalid config", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

      try {
        await szum.render({
          version: "2026-03-20",
          format: "svg",
          // @ts-expect-error testing invalid discriminator value
          marks: [{ type: "invalid" }],
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
        await bad.render(VALID_CONFIG);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SzumError);
        expect((err as SzumError).status).toBe(401);
      }
    });
  });

  describe("charts.create", () => {
    it("returns the chart object for a valid config", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });
      const result = await szum.charts.create(VALID_CONFIG);

      expect(typeof result.imageUrl).toBe("string");
      expect(result.imageUrl).toMatch(/^https?:\/\//);
      expect(result.imageUrl).toContain("/c/");
      expect(typeof result.embedUrl).toBe("string");
      expect(result.embedUrl).toMatch(/^https?:\/\//);
      expect(result.embedUrl).toContain("/e/");
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
    });

    it("throws SzumError on invalid config", async () => {
      const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

      try {
        await szum.charts.create({
          version: "2026-03-20",
          format: "svg",
          // @ts-expect-error testing invalid discriminator value
          marks: [{ type: "invalid" }],
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
        await bad.charts.create(VALID_CONFIG);
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
      const created = await szum.charts.create(VALID_CONFIG);
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
