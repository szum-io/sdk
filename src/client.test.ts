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

describe("Szum (integration)", () => {
  const szum = new Szum({ apiKey: API_KEY, baseUrl: BASE_URL });

  describe("render", () => {
    it.skipIf(!HAS_API_KEY)(
      "returns SVG bytes for a valid config",
      async () => {
        const result = await szum.render(VALID_CONFIG);

        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.byteLength).toBeGreaterThan(0);

        const text = new TextDecoder().decode(result);
        expect(text).toContain("<svg");
      },
    );

    it.skipIf(!HAS_API_KEY)(
      "returns PNG bytes for a valid config",
      async () => {
        const result = await szum.render({
          ...VALID_CONFIG,
          format: "png" as const,
        });

        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.byteLength).toBeGreaterThan(0);

        const header = result.slice(0, 4);
        expect(header).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      },
    );

    it.skipIf(!HAS_API_KEY)("throws SzumError on invalid config", async () => {
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
    it.skipIf(!HAS_API_KEY)(
      "returns { url, id } for a valid config",
      async () => {
        const result = await szum.charts.create(VALID_CONFIG);

        expect(typeof result.url).toBe("string");
        expect(result.url).toMatch(/^https?:\/\//);
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
      },
    );

    it.skipIf(!HAS_API_KEY)("throws SzumError on invalid config", async () => {
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
    it.skipIf(!HAS_API_KEY)(
      "creates a chart and then deletes it by id",
      async () => {
        const created = await szum.charts.create(VALID_CONFIG);
        await szum.charts.delete(created.id);

        try {
          await szum.charts.delete(created.id);
          expect.unreachable("second delete should have thrown 404");
        } catch (err) {
          expect(err).toBeInstanceOf(SzumError);
          expect((err as SzumError).status).toBe(404);
        }
      },
    );

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
