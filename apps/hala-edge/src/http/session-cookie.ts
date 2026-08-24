const SESSION_COOKIE_NAME = "hala_session";

function encodeCookieValue(value: string): string {
  return encodeURIComponent(value);
}

function extractCookieValue(header: string, name: string): string | null {
  const pairs = header.split(";");
  const prefix = `${name}=`;
  for (const rawPair of pairs) {
    const pair = rawPair.trim();
    if (!pair.startsWith(prefix)) {
      continue;
    }

    const encodedValue = pair.slice(prefix.length);
    try {
      const decoded = decodeURIComponent(encodedValue);
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  return extractCookieValue(cookieHeader ?? "", SESSION_COOKIE_NAME);
}

export function buildSessionCookie(
  rawToken: string,
  expiresAt: string,
  isProduction: boolean
): string {
  const secure = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeCookieValue(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function buildExpiredSessionCookie(isProduction: boolean): string {
  const secure = isProduction ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
