import { describe, expect, it } from "vitest";

import { integrationEnvironmentProblem } from "./integration-policy";

const readyEnvironment = {
  apiKey: "test-key",
  baseUrl: "https://staging.szum.io",
};

describe("integration environment policy", () => {
  it.each([
    "https://staging.szum.io",
    "https://staging.szum.io/",
    "http://localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("allows an explicit staging-backed target at %s", (baseUrl) => {
    expect(
      integrationEnvironmentProblem({ ...readyEnvironment, baseUrl }),
    ).toBeNull();
  });

  it.each([
    "https://szum.io",
    "https://example.com",
    "https://staging.szum.io/path",
    "https://localhost.example.com",
    "file:///tmp/server",
    "not a URL",
  ])("rejects unsafe integration target %s", (baseUrl) => {
    expect(
      integrationEnvironmentProblem({ ...readyEnvironment, baseUrl }),
    ).toMatch(/SZUM_BASE_URL/);
  });

  it("requires an injected API key", () => {
    expect(
      integrationEnvironmentProblem({ ...readyEnvironment, apiKey: " " }),
    ).toMatch(/SZUM_API_KEY/);
  });
});
