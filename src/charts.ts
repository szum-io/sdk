import type { ChartConfig, RequestOptions } from "./client";
import { SzumInvalidRequestError } from "./errors";
import type { ChartConfigInput } from "./generated/types";
import { parseJsonObject, requireString } from "./json";

type InternalApi = {
  request: (
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ) => Promise<Response>;
  resolveConfig: (config: ChartConfig) => ChartConfigInput;
};

export class SzumCharts {
  private readonly api: InternalApi;

  constructor(api: InternalApi) {
    this.api = api;
  }

  async create(
    config: ChartConfig,
    options?: RequestOptions,
  ): Promise<{ url: string; id: string }> {
    const response = await this.api.request(
      "/api/charts",
      {
        method: "POST",
        body: JSON.stringify({ config: this.api.resolveConfig(config) }),
      },
      options,
    );

    const obj = await parseJsonObject(response);
    const url = requireString(obj, "url", response);
    const id = requireString(obj, "id", response);

    return { url, id };
  }

  async delete(id: string, options?: RequestOptions): Promise<void> {
    if (typeof id !== "string" || id.length === 0) {
      throw new SzumInvalidRequestError({
        message: "id must be a non-empty string",
        status: 0,
      });
    }

    await this.api.request(
      `/api/charts/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      options,
    );
  }
}
