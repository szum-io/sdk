import type { ChartDiagnostic } from "./generated/validation";
import { isChartDiagnostics } from "./generated/response-validators.js";

export const parseChartDiagnostics = (
  value: unknown,
): ChartDiagnostic[] | null => (isChartDiagnostics(value) ? value : null);
