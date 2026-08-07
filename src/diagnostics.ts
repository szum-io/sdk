import type { ChartDiagnostic } from "./generated/validation";

const SEVERITIES = {
  error: true,
  warning: true,
  suggestion: true,
} satisfies Record<ChartDiagnostic["severity"], true>;

export const parseChartDiagnostics = (
  value: unknown,
): ChartDiagnostic[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const diagnostics: ChartDiagnostic[] = [];

  for (const entry of value) {
    const diagnostic = parseChartDiagnostic(entry);

    if (!diagnostic) {
      return null;
    }

    diagnostics.push(diagnostic);
  }

  return diagnostics;
};

const parseChartDiagnostic = (value: unknown): ChartDiagnostic | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { code, severity, path, relatedPaths, message, details } = value;

  if (
    typeof code !== "string" ||
    !isSeverity(severity) ||
    !isDiagnosticPath(path) ||
    typeof message !== "string" ||
    !isRecord(details) ||
    (relatedPaths !== undefined &&
      (!Array.isArray(relatedPaths) || !relatedPaths.every(isDiagnosticPath)))
  ) {
    return null;
  }

  return {
    code,
    severity,
    path,
    ...(relatedPaths !== undefined ? { relatedPaths } : {}),
    message,
    details,
  };
};

const isDiagnosticPath = (value: unknown): value is (string | number)[] =>
  Array.isArray(value) &&
  value.every((part) => typeof part === "string" || typeof part === "number");

const isSeverity = (value: unknown): value is ChartDiagnostic["severity"] =>
  typeof value === "string" && value in SEVERITIES;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
