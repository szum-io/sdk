import { SzumCharts } from "./charts";
import type { ChartDocument, RequestOptions } from "./contracts";
import type { RenderMetadata, RenderUsage } from "./generated/render";
import type { SavedChartCreateParams } from "./generated/saved-charts";
import type { ChartValidationResult } from "./generated/validation";
import { SzumAPIError } from "./errors";
import { parseChartDiagnostics } from "./diagnostics";
import {
  fetchWithRetry,
  parseRequestId,
  type RequestPolicy,
  USER_AGENT,
} from "./http";
import {
  assertSharedTheme,
  assertTransportOptions,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  resolveDocument,
  resolveBaseUrl,
} from "./options";
import { SzumThemes } from "./themes";
import {
  parseValidationResponse,
  VALIDATION_REQUEST_POLICY,
} from "./validation";

export type SzumOptions = {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
};

export type RenderOptions = RequestOptions & {
  sharedTheme?: NonNullable<SavedChartCreateParams["sharedTheme"]>;
};

export type RenderResult = RenderMetadata & {
  data: Uint8Array;
};

export class Szum {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  readonly charts: SzumCharts;
  readonly themes: SzumThemes;

  constructor({ apiKey, baseUrl, timeout, maxRetries }: SzumOptions) {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      throw new Error(
        "@szum-io/sdk is server-side only. Running it in a browser would expose your API key. Save charts server-side and pass the URLs to the client.",
      );
    }

    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("apiKey is required and must be a non-empty string");
    }

    assertTransportOptions({ timeout, maxRetries });

    this.apiKey = apiKey;
    this.baseUrl = resolveBaseUrl(baseUrl);
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = maxRetries ?? DEFAULT_MAX_RETRIES;

    this.charts = new SzumCharts({
      request: (path, init, opts) => this.request(path, init, opts),
      resolveDocument,
    });
    this.themes = new SzumThemes({
      request: (path, init, opts) => this.request(path, init, opts),
    });
  }

  async render(
    request: ChartDocument,
    options?: RenderOptions,
  ): Promise<Uint8Array> {
    const response = await this.renderResponse(request, options);

    return new Uint8Array(await response.arrayBuffer());
  }

  async renderWithMetadata(
    request: ChartDocument,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    const response = await this.renderResponse(request, options);
    const buffer = await response.arrayBuffer();

    return {
      data: new Uint8Array(buffer),
      contentType: requireHeader(response, "content-type"),
      fontFallback: parseOptionalTrueHeader(response, "x-font-fallback"),
      diagnostics: parseRenderDiagnostics(response),
      usage: parseRenderUsage(response),
    };
  }

  async validate(
    document: ChartDocument,
    options?: RequestOptions,
  ): Promise<ChartValidationResult> {
    const response = await this.request(
      "/validate",
      {
        method: "POST",
        body: JSON.stringify(resolveDocument(document)),
      },
      options,
      VALIDATION_REQUEST_POLICY,
    );

    return parseValidationResponse(response);
  }

  private async renderResponse(
    request: ChartDocument,
    options?: RenderOptions,
  ): Promise<Response> {
    assertSharedTheme(options?.sharedTheme);

    const query =
      options?.sharedTheme === undefined
        ? ""
        : `?${new URLSearchParams({ sharedTheme: options.sharedTheme })}`;

    return this.request(
      `/chart${query}`,
      {
        method: "POST",
        body: JSON.stringify(resolveDocument(request)),
      },
      options,
      { retryMode: "rate-limit-only" },
    );
  }

  private async request(
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
    policy: RequestPolicy = {},
  ): Promise<Response> {
    return fetchWithRetry(
      `${this.baseUrl}${path}`,
      { ...init, headers: this.createHeaders(options?.idempotencyKey) },
      {
        timeout: options?.timeout ?? this.timeout,
        maxRetries: this.maxRetries,
        signal: options?.signal,
        ...policy,
      },
    );
  }

  private createHeaders(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return headers;
  }
}

const parseRenderDiagnostics = (response: Response) => {
  const name = "x-chart-diagnostics";
  const header = requireHeader(response, name);
  let diagnostics;

  try {
    diagnostics = parseChartDiagnostics(JSON.parse(decodeURIComponent(header)));
  } catch {
    throw invalidResponseHeader(response, name);
  }

  if (diagnostics === null) {
    throw invalidResponseHeader(response, name);
  }

  return diagnostics;
};

const parseRenderUsage = (response: Response): RenderUsage => ({
  used: parseUsageHeader(response, "x-usage-used"),
  limit: parseUsageHeader(response, "x-usage-limit"),
  remaining: parseUsageHeader(response, "x-usage-remaining"),
  overage: parseOptionalTrueHeader(response, "x-usage-overage"),
});

const parseUsageHeader = (response: Response, name: string): number => {
  const value = requireHeader(response, name);
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidResponseHeader(response, name);
  }

  return parsed;
};

const parseOptionalTrueHeader = (response: Response, name: string): boolean => {
  const value = response.headers.get(name);

  if (value === null) {
    return false;
  }

  if (value !== "true") {
    throw invalidResponseHeader(response, name);
  }

  return true;
};

const requireHeader = (response: Response, name: string): string => {
  const value = response.headers.get(name);

  if (!value) {
    throw invalidResponseHeader(response, name);
  }

  return value;
};

const invalidResponseHeader = (
  response: Response,
  name: string,
): SzumAPIError =>
  new SzumAPIError({
    message: `Invalid response: missing or invalid '${name}' header`,
    status: response.status,
    requestId: parseRequestId(response),
  });
