import type { ChartConfig, RequestOptions } from "./client";
import { SzumError, SzumInvalidRequestError } from "./errors";
import type { ChartConfigInput } from "./generated/types";
import {
  parseJsonObject,
  requireNumber,
  requireObject,
  requireString,
} from "./json";

type InternalApi = {
  request: (
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ) => Promise<Response>;
  resolveConfig: (config: ChartConfig) => ChartConfigInput;
};

/**
 * Origin of a saved chart. Typed as an **open** union  on purpose – treat it
 * as a string with known values.
 */
export type SavedChartSource = "api" | "app" | "figma" | "mcp" | (string & {});

/**
 * A saved chart. The same shape is returned by `create`, `get`, `update`, and
 * each item of `list`. The config, rendered image, and interactive embed are
 * addressable sub-resources: fetch the config with `getConfig(id)`, embed the
 * image from `imageUrl`, the interactive version from `embedUrl`.
 */
export type SavedChart = {
  id: string;
  source: SavedChartSource;
  title: string;
  /** ISO-8601 timestamp, e.g. "2024-06-01T00:00:00.000Z". */
  createdAt: string;
  /** ISO-8601 timestamp, e.g. "2024-06-01T00:00:00.000Z". */
  updatedAt: string;
  sizeBytes: number;
  /** Rendered-image URL; add `.png`/`.svg` to force a format. */
  imageUrl: string;
  /** Interactive embed URL. */
  embedUrl: string;
  /** Owner-only endpoint that returns this chart's config (`getConfig`). */
  configUrl: string;
};

export type SavedChartPage = {
  items: SavedChart[];
  nextCursor: string | null;
};

/**
 * Why a requested config wasn't returned: `"not_found"` (unowned or absent) or
 * `"unavailable"` (a transient storage error, safe to retry).
 */
export type ConfigMissingReason = "not_found" | "unavailable" | (string & {});

export type SavedChartConfigs = {
  configs: { id: string; config: ChartConfigInput }[];
  missing: { id: string; reason: ConfigMissingReason }[];
};

const assertId = (id: string): void => {
  if (typeof id !== "string" || id.length === 0) {
    throw new SzumInvalidRequestError({
      message: "id must be a non-empty string",
      status: 0,
    });
  }
};

// imageUrl/embedUrl/id are parsed first so a malformed response reports the
// most recognizable missing field.
const parseSavedChart = (
  response: Response,
  obj: Record<string, unknown>,
): SavedChart => {
  const imageUrl = requireString(obj, "imageUrl", response);
  const embedUrl = requireString(obj, "embedUrl", response);
  const id = requireString(obj, "id", response);
  const source = requireString(obj, "source", response) as SavedChartSource;
  const title = requireString(obj, "title", response);
  const createdAt = requireString(obj, "createdAt", response);
  const updatedAt = requireString(obj, "updatedAt", response);
  const sizeBytes = requireNumber(obj, "sizeBytes", response);
  const configUrl = requireString(obj, "configUrl", response);

  return {
    id,
    source,
    title,
    createdAt,
    updatedAt,
    sizeBytes,
    imageUrl,
    embedUrl,
    configUrl,
  };
};

export class SzumCharts {
  private readonly api: InternalApi;

  constructor(api: InternalApi) {
    this.api = api;
  }

  /**
   * Save a config server-side; returns the created chart. Retry-safe: an
   * `Idempotency-Key` is generated per call (and reused across this call's
   * automatic retries), so a committed-but-timed-out create can't produce a
   * duplicate. Pass `options.idempotencyKey` to dedupe across separate calls.
   */
  async create(
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<SavedChart> {
    const response = await this.api.request(
      "/api/charts",
      {
        method: "POST",
        body: JSON.stringify({ config: this.api.resolveConfig(config) }),
      },
      {
        ...options,
        idempotencyKey:
          options?.idempotencyKey ?? globalThis.crypto.randomUUID(),
      },
    );

    return parseSavedChart(response, await parseJsonObject(response));
  }

  /**
   * List your saved charts, newest first. Returns one page plus a `nextCursor`
   * (pass it back as `cursor` to page on; `null` means the last page). Omit
   * `source` to list every chart, or filter to one or several of `"figma"` /
   * `"api"` / `"app"` / `"mcp"`. `limit` defaults to 100 (max 1000).
   */
  async list(
    params?: {
      source?: SavedChartSource | SavedChartSource[];
      cursor?: string;
      limit?: number;
    },
    options?: RequestOptions,
  ): Promise<SavedChartPage> {
    const search = new URLSearchParams();

    if (params?.source) {
      const source = Array.isArray(params.source)
        ? params.source.join(",")
        : params.source;

      if (source) {
        search.set("source", source);
      }
    }

    if (params?.cursor) {
      search.set("cursor", params.cursor);
    }

    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }

    const query = search.toString();
    const response = await this.api.request(
      `/api/charts${query ? `?${query}` : ""}`,
      { method: "GET" },
      options,
    );

    const obj = await parseJsonObject(response);
    const items = Array.isArray(obj.items) ? obj.items : [];

    return {
      items: items.map((item) =>
        parseSavedChart(response, item as Record<string, unknown>),
      ),
      nextCursor: typeof obj.nextCursor === "string" ? obj.nextCursor : null,
    };
  }

  /** Read a single chart's metadata by id. */
  async get(id: string, options?: RequestOptions): Promise<SavedChart> {
    assertId(id);

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}`,
      { method: "GET" },
      options,
    );

    return parseSavedChart(response, await parseJsonObject(response));
  }

  /** Read a chart's config. */
  async getConfig(
    id: string,
    options?: RequestOptions,
  ): Promise<ChartConfigInput> {
    assertId(id);

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}/config`,
      { method: "GET" },
      options,
    );

    const obj = await parseJsonObject(response);

    return requireObject(
      obj,
      "config",
      response,
    ) as unknown as ChartConfigInput;
  }

  /**
   * Read several charts' configs in one request (max 100 ids). Owner-only.
   * Returns `{ configs, missing }`: `configs` is `{ id, config }` (order not
   * guaranteed); `missing` lists any requested id that didn't return a config,
   * each with a `reason` – an open set, today `"not_found"` (unowned or absent)
   * or `"unavailable"` (a transient storage error, safe to retry).
   */
  async getConfigs(
    ids: string[],
    options?: RequestOptions,
  ): Promise<SavedChartConfigs> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new SzumInvalidRequestError({
        message: "ids must be a non-empty array",
        status: 0,
      });
    }

    const response = await this.api.request(
      `/api/charts/configs?ids=${encodeURIComponent(ids.join(","))}`,
      { method: "GET" },
      options,
    );

    const obj = await parseJsonObject(response);
    const rawConfigs = Array.isArray(obj.configs) ? obj.configs : [];
    const rawMissing = Array.isArray(obj.missing) ? obj.missing : [];

    const configs = rawConfigs.flatMap((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as { id?: unknown; config?: unknown };

        if (
          typeof record.id === "string" &&
          record.config &&
          typeof record.config === "object"
        ) {
          return [{ id: record.id, config: record.config as ChartConfigInput }];
        }
      }

      return [];
    });

    const missing = rawMissing.flatMap((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as { id?: unknown; reason?: unknown };

        if (typeof record.id === "string") {
          const reason: ConfigMissingReason =
            typeof record.reason === "string" && record.reason.length > 0
              ? record.reason
              : "not_found";

          return [{ id: record.id, reason }];
        }
      }

      return [];
    });

    return { configs, missing };
  }

  /** Replace a chart's config in place (same id, stable URLs). */
  async update(
    id: string,
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<SavedChart> {
    assertId(id);

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}/config`,
      {
        method: "PUT",
        body: JSON.stringify({ config: this.api.resolveConfig(config) }),
      },
      options,
    );

    return parseSavedChart(response, await parseJsonObject(response));
  }

  /**
   * Delete a saved chart by id. Idempotent: deleting an already-deleted or
   * never-existed id resolves rather than throwing (the server's `404` is
   * swallowed), so a timed-out-then-retried delete is safe.
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    assertId(id);

    try {
      await this.api.request(
        `/api/charts/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        options,
      );
    } catch (err) {
      if (err instanceof SzumError && err.status === 404) {
        return;
      }

      throw err;
    }
  }
}
