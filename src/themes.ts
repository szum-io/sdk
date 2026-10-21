import type { RequestOptions } from "./contracts";
import type { ThemeName, ThemeOverrides } from "./generated/document";
import {
  parseJsonObject,
  requireArray,
  requireBoolean,
  requireObject,
  requireRecordValue,
  requireString,
  requireStringOrNull,
} from "./json";

type InternalApi = {
  request: (
    path: string,
    init: Omit<RequestInit, "headers">,
    options?: RequestOptions,
  ) => Promise<Response>;
};

export type WorkspaceTheme = {
  name: string;
  theme: ThemeName;
  themeOverrides?: ThemeOverrides;
  isDefault: boolean;
};

export type WorkspaceThemes = {
  themes: WorkspaceTheme[];
  defaultBuiltInTheme: ThemeName | null;
};

export class SzumThemes {
  private readonly api: InternalApi;

  constructor(api: InternalApi) {
    this.api = api;
  }

  /**
   * List the workspace's shared themes, the default first. Pass a theme's
   * `name` as `sharedTheme` to `charts.create` or `charts.update` to link a
   * chart to it. When new charts start in one of Szum's built-in themes
   * instead, `defaultBuiltInTheme` names it. A personal workspace has no
   * shared themes and no default.
   */
  async list(options?: RequestOptions): Promise<WorkspaceThemes> {
    const response = await this.api.request(
      "/api/themes",
      { method: "GET" },
      options,
    );
    const obj = await parseJsonObject(response);

    return {
      themes: requireArray(obj, "themes", response).map((entry) => {
        return parseTheme(
          requireRecordValue(entry, "themes[]", response),
          response,
        );
      }),
      defaultBuiltInTheme: requireStringOrNull(
        obj,
        "defaultBuiltInTheme",
        response,
      ) as ThemeName | null,
    };
  }
}

const parseTheme = (
  record: Record<string, unknown>,
  response: Response,
): WorkspaceTheme => {
  const name = requireString(record, "name", response);
  const theme = requireString(record, "theme", response) as ThemeName;
  const isDefault = requireBoolean(record, "isDefault", response);

  if (!("themeOverrides" in record)) {
    return { name, theme, isDefault };
  }

  return {
    name,
    theme,
    themeOverrides: requireObject(
      record,
      "themeOverrides",
      response,
    ) as ThemeOverrides,
    isDefault,
  };
};
