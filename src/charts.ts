import type { ChartDocument, RequestOptions } from "./contracts";
import { SzumAPIError, SzumError, SzumInvalidRequestError } from "./errors";
import type {
  DocumentMissingReason,
  SavedChart,
  SavedChartDocuments,
  SavedChartCreateParams,
  SavedChartDocumentState,
  SavedChartListParams,
  SavedChartPage,
  SavedChartSource,
} from "./generated/saved-charts";
import type { ChartDocumentInput } from "./generated/document";
import { isChartDocument } from "./generated/response-validators.js";
import {
  parseJsonObject,
  requireArray,
  requireBoolean,
  requireNonnegativeInteger,
  requireObject,
  requireObjectOrNull,
  requireRecordValue,
  requireString,
  requireStringOrNull,
} from "./json";
import { parseRequestId } from "./http";

type InternalApi = {
  request: (
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ) => Promise<Response>;
  resolveDocument: (document: ChartDocument) => ChartDocumentInput;
};

export type SavedChartCreateOptions = RequestOptions & SavedChartCreateParams;

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
  const sizeBytes = requireNonnegativeInteger(obj, "sizeBytes", response);
  const publishedAt = requireStringOrNull(obj, "publishedAt", response);
  const documentUrl = requireString(obj, "documentUrl", response);

  assertIsoTimestamp(response, "createdAt", createdAt);
  assertIsoTimestamp(response, "updatedAt", updatedAt);

  if (publishedAt !== null) {
    assertIsoTimestamp(response, "publishedAt", publishedAt);
  }

  assertAbsoluteUrl(response, "imageUrl", imageUrl);
  assertAbsoluteUrl(response, "embedUrl", embedUrl);
  assertAbsoluteUrl(response, "documentUrl", documentUrl);

  return {
    id,
    source,
    title,
    createdAt,
    updatedAt,
    sizeBytes,
    publishedAt,
    imageUrl,
    embedUrl,
    documentUrl,
  };
};

export class SzumCharts {
  private readonly api: InternalApi;

  constructor(api: InternalApi) {
    this.api = api;
  }

  /**
   * Save a document server-side; returns the created chart. Retry-safe: an
   * `Idempotency-Key` is generated per call (and reused across this call's
   * automatic retries), so a committed-but-timed-out create can't produce a
   * duplicate. Pass `options.idempotencyKey` to dedupe across separate calls.
   */
  async create(
    document: ChartDocument,
    options?: SavedChartCreateOptions,
  ): Promise<SavedChart> {
    if (
      options?.idempotencyKey !== undefined &&
      (typeof options.idempotencyKey !== "string" ||
        options.idempotencyKey.trim().length === 0)
    ) {
      throw new SzumInvalidRequestError({
        message: "idempotencyKey must be a non-empty string",
        status: 0,
      });
    }

    if (options?.title !== undefined && typeof options.title !== "string") {
      throw new SzumInvalidRequestError({
        message: "title must be a string",
        status: 0,
      });
    }

    const response = await this.api.request(
      "/api/charts",
      {
        method: "POST",
        body: JSON.stringify({
          document: this.api.resolveDocument(document),
          ...(options?.title !== undefined ? { title: options.title } : {}),
        }),
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
   * List your saved charts. Returns one page plus a `nextCursor` (pass it back
   * as `cursor` to page on; `null` means the last page). Omit `source` to list
   * every chart. The cursor is coupled to `sort`, so keep the sort stable while
   * paging. `q` is a case-insensitive title substring filter; when set, the page
   * also carries `total` (the exact match count). Each item carries a `hasDraft`
   * flag.
   */
  async list(
    params?: SavedChartListParams,
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

    if (params?.sort) {
      search.set("sort", params.sort);
    }

    if (params?.q) {
      search.set("q", params.q);
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
    const items = requireArray(obj, "items", response);
    const nextCursor = requireStringOrNull(obj, "nextCursor", response);
    const total =
      "total" in obj
        ? requireNonnegativeInteger(obj, "total", response)
        : undefined;

    return {
      items: items.map((item) => {
        const record = requireRecordValue(item, "items[]", response);

        return {
          ...parseSavedChart(response, record),
          hasDraft: requireBoolean(record, "hasDraft", response),
        };
      }),
      nextCursor,
      ...(total !== undefined ? { total } : {}),
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

  /** Read a chart's complete owner document, including publication and draft. */
  async getDocumentState(
    id: string,
    options?: RequestOptions,
  ): Promise<SavedChartDocumentState> {
    assertId(id);

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}/document`,
      { method: "GET" },
      options,
    );
    const obj = await parseJsonObject(response);
    const document = requireObjectOrNull(obj, "document", response);
    const draft = requireObjectOrNull(obj, "draft", response);
    const publishedAt = requireStringOrNull(obj, "publishedAt", response);

    if (publishedAt !== null) {
      assertIsoTimestamp(response, "publishedAt", publishedAt);
    }

    return {
      document: document === null ? null : parseDocument(document, response),
      draft: draft === null ? null : parseDocument(draft, response),
      publishedAt,
      title: requireString(obj, "title", response),
    };
  }

  /**
   * Read several charts' preview documents in one request (max 100 ids).
   * Returns `{ documents, missing }`: `documents` is `{ id, document }` (order not
   * guaranteed); `missing` lists any requested id that didn't return a document,
   * each with a `reason` – an open set, today `"not_found"` (unowned or absent)
   * or `"unavailable"` (storage or stored-data unavailable; retry may not help).
   */
  async getDocuments(
    ids: string[],
    options?: RequestOptions,
  ): Promise<SavedChartDocuments> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new SzumInvalidRequestError({
        message: "ids must be a non-empty array",
        status: 0,
      });
    }

    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length > 100) {
      throw new SzumInvalidRequestError({
        message: "ids must contain at most 100 entries",
        status: 0,
      });
    }

    uniqueIds.forEach(assertId);

    if (uniqueIds.some((id) => id.includes(",") || id.trim() !== id)) {
      throw new SzumInvalidRequestError({
        message: "ids must not contain commas or surrounding whitespace",
        status: 0,
      });
    }

    const response = await this.api.request(
      `/api/charts/documents?ids=${encodeURIComponent(uniqueIds.join(","))}`,
      { method: "GET" },
      options,
    );

    const obj = await parseJsonObject(response);
    const rawDocuments = requireArray(obj, "documents", response);
    const rawMissing = requireArray(obj, "missing", response);
    const documents = rawDocuments.map((entry) => {
      const record = requireRecordValue(entry, "documents[]", response);
      const id = requireString(record, "id", response);

      return {
        id,
        document: parseDocument(
          requireObject(record, "document", response),
          response,
        ),
      };
    });
    const missing = rawMissing.map((entry) => {
      const record = requireRecordValue(entry, "missing[]", response);
      const id = requireString(record, "id", response);
      const reason = requireString(
        record,
        "reason",
        response,
      ) as DocumentMissingReason;

      if (reason.length === 0) {
        throw invalidResponseField(response, "reason");
      }

      return { id, reason };
    });

    const returnedIds = [...documents, ...missing].map(({ id }) => id);

    if (
      returnedIds.length !== uniqueIds.length ||
      new Set(returnedIds).size !== uniqueIds.length ||
      returnedIds.some((id) => !uniqueIds.includes(id))
    ) {
      throw invalidResponseField(response, "documents/missing ids");
    }

    return { documents, missing };
  }

  /** Replace a chart's document in place (same id, stable URLs). */
  async update(
    id: string,
    document: ChartDocument,
    options?: RequestOptions,
  ): Promise<SavedChart> {
    assertId(id);

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}/document`,
      {
        method: "PUT",
        body: JSON.stringify({ document: this.api.resolveDocument(document) }),
      },
      options,
    );

    return parseSavedChart(response, await parseJsonObject(response));
  }

  /**
   * Rename a chart – metadata only. Updates the chart's title without touching
   * its document, so the id and the `/c/` + `/e/` URLs are unchanged and nothing
   * is re-rendered or re-published. Returns the updated chart object.
   */
  async rename(
    id: string,
    title: string,
    options?: RequestOptions,
  ): Promise<SavedChart> {
    assertId(id);

    if (typeof title !== "string") {
      throw new SzumInvalidRequestError({
        message: "title must be a string",
        status: 0,
      });
    }

    const response = await this.api.request(
      `/api/charts/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
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

const parseDocument = (
  value: unknown,
  response: Response,
): ChartDocumentInput => {
  if (!isChartDocument(value)) {
    throw invalidResponseField(response, "document");
  }

  return value;
};

const assertIsoTimestamp = (
  response: Response,
  field: string,
  value: string,
): void => {
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw invalidResponseField(response, field);
  }
};

const assertAbsoluteUrl = (
  response: Response,
  field: string,
  value: string,
): void => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw invalidResponseField(response, field);
    }
  } catch {
    throw invalidResponseField(response, field);
  }
};

const invalidResponseField = (
  response: Response,
  field: string,
): SzumAPIError =>
  new SzumAPIError({
    message: `Invalid response: missing or invalid '${field}' field`,
    status: response.status,
    requestId: parseRequestId(response),
  });
