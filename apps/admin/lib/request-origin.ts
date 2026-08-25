type RequestHeaders = Pick<Headers, "get">;

function normalizedHost(rawHost: string, protocol: string) {
  try {
    const parsed = new URL(`${protocol}//${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isSameOriginRequestHeaders(headers: RequestHeaders) {
  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase() || null;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = headers.get("origin")?.trim() || null;
  if (!origin) return true;

  const host = headers.get("host")?.trim() || null;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    if (!/^https?:$/.test(parsedOrigin.protocol)) return false;
    if (parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
      return false;
    }
    return parsedOrigin.host.toLowerCase() === normalizedHost(host, parsedOrigin.protocol);
  } catch {
    return false;
  }
}
