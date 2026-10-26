import type { RequestOptions } from "./contracts";
import { SzumInvalidRequestError } from "./errors";
import type { ChartDocumentInput } from "./generated/document";
import type { SavedChart, SavedChartSource } from "./generated/saved-charts";
import type { ChartValidationResult } from "./generated/validation";
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
import { parseValidationResult } from "./response-documents";
import {
  assertId,
  assertIsoTimestamp,
  invalidResponseField,
  parseDocument,
  parseSavedChart,
} from "./saved-chart-response";

type InternalApi = {
  request: (
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ) => Promise<Response>;
};

type OpenString = string & Record<never, never>;

export type SavedChartVersionReference = { id: string; number: number };

export type SavedChartVersion = {
  id: string;
  number: number;
  /** How the version was made; `imported` predates version history. */
  kind: "create" | "publish" | "restore" | "move" | "imported" | OpenString;
  publishedAt: string | null;
  publishedByUserId: string | null;
  publishedByName: string | null;
  client: SavedChartSource | null;
  apiKeyName: string | null;
  mcpClientName: string | null;
  baseVersion: SavedChartVersionReference | null;
  restoredFromVersion: SavedChartVersionReference | null;
  /** What changed from the version before it; `null` when unknown. */
  changedSections:
    | ("data" | "design" | "size" | "output" | "theme" | "title" | OpenString)[]
    | null;
  title: string;
  /** The version's name, or `null`. */
  label: string | null;
  /** Set when the version's content was pruned for storage or deleted. */
  removal: {
    at: string;
    reason: "pruned" | "deleted" | OpenString;
    byName: string | null;
  } | null;
  sizeBytes: number;
  isCurrent: boolean;
};

export type SavedChartVersionPage = {
  currentVersion: SavedChartVersionReference | null;
  items: SavedChartVersion[];
  nextCursor: string | null;
};

export type SavedChartVersionListParams = {
  /** List only named versions. */
  named?: boolean;
  cursor?: string;
  limit?: number;
};

export type SavedChartVersionPreview =
  | {
      state: "ready";
      document: ChartDocumentInput;
      validation: ChartValidationResult;
    }
  | { state: "blocked"; validation: ChartValidationResult };

export type SavedChartVersionRestore =
  | {
      state: "ready";
      document: ChartDocumentInput;
      validation: ChartValidationResult;
      lossCodes: string[];
      fingerprint: string;
    }
  | {
      state: "blocked";
      reason:
        | "source_pending"
        | "source_stale"
        | "source_invalid"
        | "source_blocked"
        | "plan_required"
        | "rule_blocked"
        | "effective_invalid"
        | OpenString;
      document: ChartDocumentInput | null;
      validation: ChartValidationResult | null;
      lossCodes: string[];
      fingerprint: string | null;
    };

export type SavedChartVersionPreparation =
  | { state: "removed"; reason: "pruned" | "deleted" | OpenString }
  | { state: "unavailable"; reason: string }
  | {
      state: "retained";
      preview: SavedChartVersionPreview;
      restore: SavedChartVersionRestore;
    };

export type SavedChartVersionDetail = {
  version: SavedChartVersion;
  preparation: SavedChartVersionPreparation;
};

export type SavedChartVersionRestoreOptions = RequestOptions & {
  /** The `restore.fingerprint` you read; refuses with `409` when it changed. */
  fingerprint?: string;
  acceptLosses?: string[];
  expectedUpdatedAt?: string;
  title?: string;
};

export type SavedChartVersionDuplicateOptions = RequestOptions & {
  fingerprint?: string;
  acceptLosses?: string[];
  title?: string;
};

export type SavedChartWithVersion = SavedChart & {
  currentVersion: SavedChartVersionReference | null;
};

export class SzumChartVersions {
  private readonly api: InternalApi;

  constructor(api: InternalApi) {
    this.api = api;
  }

  /**
   * List a chart's versions, newest first. Every publication is a version:
   * create, update, restore, and a move between workspaces. Pass `nextCursor`
   * back as `cursor` for older versions.
   */
  async list(
    id: string,
    params?: SavedChartVersionListParams,
    options?: RequestOptions,
  ): Promise<SavedChartVersionPage> {
    assertId(id);

    const search = new URLSearchParams();

    if (params?.named) {
      search.set("named", "1");
    }

    if (params?.cursor) {
      search.set("cursor", params.cursor);
    }

    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }

    const query = search.toString();
    const response = await this.api.request(
      `${versionsPath(id)}${query ? `?${query}` : ""}`,
      { method: "GET" },
      options,
    );
    const obj = await parseJsonObject(response);

    return {
      currentVersion: parseReference(obj, "currentVersion", response),
      items: requireArray(obj, "items", response).map((item) => {
        return parseVersion(
          requireRecordValue(item, "items[]", response),
          response,
        );
      }),
      nextCursor: requireStringOrNull(obj, "nextCursor", response),
    };
  }

  /**
   * Read one version: its metadata, its stored document as a preview, and the
   * document a restore would publish under the workspace's current settings.
   */
  async get(
    id: string,
    number: number,
    options?: RequestOptions,
  ): Promise<SavedChartVersionDetail> {
    assertId(id);
    assertVersionNumber(number);

    const response = await this.api.request(
      versionPath(id, number),
      { method: "GET" },
      options,
    );
    const obj = await parseJsonObject(response);

    return {
      version: parseVersion(requireObject(obj, "version", response), response),
      preparation: parsePreparation(
        requireObject(obj, "preparation", response),
        response,
      ),
    };
  }

  /**
   * Publish a version again as a new version, keeping the chart's id and URLs.
   * The version it replaces stays restorable. Refused with `409` while the
   * chart has unpublished Studio changes.
   */
  async restore(
    id: string,
    number: number,
    options?: SavedChartVersionRestoreOptions,
  ): Promise<SavedChartWithVersion> {
    assertId(id);
    assertVersionNumber(number);
    assertOptionalString(options?.fingerprint, "fingerprint");
    assertOptionalString(options?.expectedUpdatedAt, "expectedUpdatedAt");
    assertOptionalString(options?.title, "title");
    assertLossCodes(options?.acceptLosses);

    const response = await this.api.request(
      `${versionPath(id, number)}/restore`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(options?.fingerprint !== undefined
            ? { fingerprint: options.fingerprint }
            : {}),
          ...(options?.acceptLosses !== undefined
            ? { acceptLosses: options.acceptLosses }
            : {}),
          ...(options?.expectedUpdatedAt !== undefined
            ? { expectedUpdatedAt: options.expectedUpdatedAt }
            : {}),
          ...(options?.title !== undefined ? { title: options.title } : {}),
        }),
      },
      options,
    );

    return parseChartWithVersion(response, await parseJsonObject(response));
  }

  /**
   * Create and publish a new chart from a version, with its own version 1.
   * Retry-safe like `charts.create`: an `Idempotency-Key` is generated per call
   * unless you pass `options.idempotencyKey`.
   */
  async duplicate(
    id: string,
    number: number,
    options?: SavedChartVersionDuplicateOptions,
  ): Promise<SavedChartWithVersion> {
    assertId(id);
    assertVersionNumber(number);
    assertOptionalString(options?.fingerprint, "fingerprint");
    assertOptionalString(options?.title, "title");
    assertLossCodes(options?.acceptLosses);

    const response = await this.api.request(
      `${versionPath(id, number)}/duplicate`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(options?.fingerprint !== undefined
            ? { fingerprint: options.fingerprint }
            : {}),
          ...(options?.acceptLosses !== undefined
            ? { acceptLosses: options.acceptLosses }
            : {}),
          ...(options?.title !== undefined ? { title: options.title } : {}),
        }),
      },
      {
        ...options,
        idempotencyKey:
          options?.idempotencyKey ?? globalThis.crypto.randomUUID(),
      },
    );

    return parseChartWithVersion(response, await parseJsonObject(response));
  }

  /**
   * Name a version, or clear its name with `null`. Names are trimmed, and an
   * empty name clears it. Named versions are pruned last. Returns the name.
   */
  async name(
    id: string,
    number: number,
    label: string | null,
    options?: RequestOptions,
  ): Promise<string | null> {
    assertId(id);
    assertVersionNumber(number);

    if (label !== null && typeof label !== "string") {
      throw new SzumInvalidRequestError({
        message: "label must be a string or null",
        status: 0,
      });
    }

    const response = await this.api.request(
      versionPath(id, number),
      { method: "PATCH", body: JSON.stringify({ label }) },
      options,
    );

    return requireStringOrNull(
      await parseJsonObject(response),
      "label",
      response,
    );
  }

  /**
   * Delete one earlier version's content, title, and name; who published it and
   * when stay in the history. Requires a workspace admin. The current version
   * can't be deleted. Returns how many versions were deleted.
   */
  async delete(
    id: string,
    number: number,
    options?: RequestOptions,
  ): Promise<{ affectedCount: number }> {
    assertId(id);
    assertVersionNumber(number);

    const response = await this.api.request(
      versionPath(id, number),
      { method: "DELETE" },
      options,
    );

    return parseErasure(response);
  }

  /**
   * Delete every earlier version below `beforeNumber`. Say whether named
   * versions go too with `includeLabelled`. Requires a workspace admin.
   */
  async deleteEarlier(
    id: string,
    params: { beforeNumber: number; includeLabelled: boolean },
    options?: RequestOptions,
  ): Promise<{ affectedCount: number }> {
    assertId(id);
    assertVersionNumber(params.beforeNumber);

    if (typeof params.includeLabelled !== "boolean") {
      throw new SzumInvalidRequestError({
        message: "includeLabelled must be a boolean",
        status: 0,
      });
    }

    const response = await this.api.request(
      versionsPath(id),
      {
        method: "DELETE",
        body: JSON.stringify({
          beforeNumber: params.beforeNumber,
          includeLabelled: params.includeLabelled,
        }),
      },
      options,
    );

    return parseErasure(response);
  }
}

const versionsPath = (id: string): string => {
  return `/api/charts/${encodeURIComponent(id)}/versions`;
};

const versionPath = (id: string, number: number): string => {
  return `${versionsPath(id)}/${String(number)}`;
};

const assertVersionNumber = (number: number): void => {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new SzumInvalidRequestError({
      message: "version number must be a positive integer",
      status: 0,
    });
  }
};

const assertOptionalString = (value: unknown, name: string): void => {
  if (value !== undefined && typeof value !== "string") {
    throw new SzumInvalidRequestError({
      message: `${name} must be a string`,
      status: 0,
    });
  }
};

const assertLossCodes = (value: unknown): void => {
  if (
    value !== undefined &&
    (!Array.isArray(value) ||
      !value.every((code) => {
        return typeof code === "string";
      }))
  ) {
    throw new SzumInvalidRequestError({
      message: "acceptLosses must be an array of strings",
      status: 0,
    });
  }
};

const parseChartWithVersion = (
  response: Response,
  obj: Record<string, unknown>,
): SavedChartWithVersion => {
  return {
    ...parseSavedChart(response, obj),
    currentVersion: parseReference(obj, "currentVersion", response),
  };
};

const parseErasure = async (
  response: Response,
): Promise<{ affectedCount: number }> => {
  const obj = await parseJsonObject(response);

  if (obj.ok !== true) {
    throw invalidResponseField(response, "ok");
  }

  return {
    affectedCount: requireNonnegativeInteger(obj, "affectedCount", response),
  };
};

const parseReference = (
  obj: Record<string, unknown>,
  key: string,
  response: Response,
): SavedChartVersionReference | null => {
  const value = requireObjectOrNull(obj, key, response);

  return value === null ? null : parseReferenceValue(value, key, response);
};

const parseReferenceValue = (
  value: Record<string, unknown>,
  key: string,
  response: Response,
): SavedChartVersionReference => {
  const id = requireString(value, "id", response);
  const number = requireNonnegativeInteger(value, "number", response);

  if (id.length === 0 || number < 1) {
    throw invalidResponseField(response, key);
  }

  return { id, number };
};

const parseVersion = (
  obj: Record<string, unknown>,
  response: Response,
): SavedChartVersion => {
  const { id, number } = parseReferenceValue(obj, "version", response);
  const publishedAt = requireStringOrNull(obj, "publishedAt", response);
  const changedSections = obj.changedSections;
  const removal = requireObjectOrNull(obj, "removal", response);

  if (publishedAt !== null) {
    assertIsoTimestamp(response, "publishedAt", publishedAt);
  }

  if (
    changedSections !== null &&
    (!Array.isArray(changedSections) ||
      !changedSections.every((section) => {
        return typeof section === "string";
      }))
  ) {
    throw invalidResponseField(response, "changedSections");
  }

  return {
    id,
    number,
    kind: requireString(obj, "kind", response),
    publishedAt,
    publishedByUserId: requireStringOrNull(obj, "publishedByUserId", response),
    publishedByName: requireStringOrNull(obj, "publishedByName", response),
    client: requireStringOrNull(obj, "client", response),
    apiKeyName: requireStringOrNull(obj, "apiKeyName", response),
    mcpClientName: requireStringOrNull(obj, "mcpClientName", response),
    baseVersion: parseReference(obj, "baseVersion", response),
    restoredFromVersion: parseReference(obj, "restoredFromVersion", response),
    changedSections: changedSections as SavedChartVersion["changedSections"],
    title: requireString(obj, "title", response),
    label: requireStringOrNull(obj, "label", response),
    removal: removal === null ? null : parseRemoval(removal, response),
    sizeBytes: requireNonnegativeInteger(obj, "sizeBytes", response),
    isCurrent: requireBoolean(obj, "isCurrent", response),
  };
};

const parseRemoval = (
  obj: Record<string, unknown>,
  response: Response,
): NonNullable<SavedChartVersion["removal"]> => {
  const at = requireString(obj, "at", response);

  assertIsoTimestamp(response, "removal.at", at);

  return {
    at,
    reason: requireString(obj, "reason", response),
    byName: requireStringOrNull(obj, "byName", response),
  };
};

const parsePreparation = (
  obj: Record<string, unknown>,
  response: Response,
): SavedChartVersionPreparation => {
  const state = requireString(obj, "state", response);

  switch (state) {
    case "removed":
    case "unavailable":
      return { state, reason: requireString(obj, "reason", response) };
    case "retained":
      return {
        state,
        preview: parsePreview(
          requireObject(obj, "preview", response),
          response,
        ),
        restore: parseRestore(
          requireObject(obj, "restore", response),
          response,
        ),
      };
    default:
      throw invalidResponseField(response, "preparation.state");
  }
};

const parsePreview = (
  obj: Record<string, unknown>,
  response: Response,
): SavedChartVersionPreview => {
  const state = requireString(obj, "state", response);
  const validation = parseValidation(obj.validation, response);

  switch (state) {
    case "ready":
      return {
        state,
        document: parseDocument(obj.document, response),
        validation,
      };
    case "blocked":
      return { state, validation };
    default:
      throw invalidResponseField(response, "preview.state");
  }
};

const parseRestore = (
  obj: Record<string, unknown>,
  response: Response,
): SavedChartVersionRestore => {
  const state = requireString(obj, "state", response);

  switch (state) {
    case "ready":
      return {
        state,
        document: parseDocument(obj.document, response),
        validation: parseValidation(obj.validation, response),
        lossCodes: parseLossCodes(obj, response),
        fingerprint: requireString(obj, "fingerprint", response),
      };
    case "blocked":
      return {
        state,
        reason: requireString(obj, "reason", response),
        document:
          obj.document === undefined
            ? null
            : parseDocument(obj.document, response),
        validation:
          obj.validation === undefined
            ? null
            : parseValidation(obj.validation, response),
        lossCodes:
          obj.lossCodes === undefined ? [] : parseLossCodes(obj, response),
        fingerprint:
          obj.fingerprint === undefined
            ? null
            : requireString(obj, "fingerprint", response),
      };
    default:
      throw invalidResponseField(response, "restore.state");
  }
};

const parseValidation = (
  value: unknown,
  response: Response,
): ChartValidationResult => {
  const result = parseValidationResult(
    requireRecordValue(value, "validation", response),
  );

  if (!result) {
    throw invalidResponseField(response, "validation");
  }

  return result;
};

const parseLossCodes = (
  obj: Record<string, unknown>,
  response: Response,
): string[] => {
  const codes = requireArray(obj, "lossCodes", response);

  if (
    !codes.every((code) => {
      return typeof code === "string";
    })
  ) {
    throw invalidResponseField(response, "lossCodes");
  }

  return codes as string[];
};
