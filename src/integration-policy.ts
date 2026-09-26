const STAGING_ORIGIN = "https://staging.szum.io";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);

export const integrationEnvironmentProblem = ({
  apiKey,
  baseUrl,
}: {
  apiKey: string;
  baseUrl: string;
}): string | null => {
  if (apiKey.trim().length === 0) {
    return "Integration tests require an injected SZUM_API_KEY.";
  }

  if (!isAllowedIntegrationBaseUrl(baseUrl)) {
    return "Integration tests require SZUM_BASE_URL to be https://staging.szum.io or a loopback HTTP(S) origin. Production and arbitrary remote origins are rejected.";
  }

  return null;
};

const isAllowedIntegrationBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return false;
    }

    if (url.origin === STAGING_ORIGIN) {
      return true;
    }

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
};
