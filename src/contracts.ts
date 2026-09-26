import type { ChartDocumentInput } from "./generated/document";
import type { ChartConfigInput } from "./generated/types";

type OptionalVersion<T extends { version: unknown }> = T extends unknown
  ? Omit<T, "version"> & { version?: T["version"] }
  : never;

export type ChartConfig = OptionalVersion<ChartConfigInput>;

export type ChartDocument = Omit<ChartDocumentInput, "config" | "version"> & {
  config: ChartConfig;
  version?: ChartDocumentInput["version"];
};

export type RequestOptions = {
  timeout?: number;
  signal?: AbortSignal;
  /**
   * Idempotency key for retry-safe creates. `charts.create` auto-generates one
   * per call (reused across that call's retries) so a committed-but-timed-out
   * create can't duplicate the chart. Pass your own to dedupe across processes.
   * Ignored by endpoints that aren't `POST /api/charts`.
   */
  idempotencyKey?: string;
};
