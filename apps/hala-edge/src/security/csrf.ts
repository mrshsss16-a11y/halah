const CSRF_COOKIE_NAME = "hala_csrf";

type CookieEnvironment = "development" | "staging" | "production";

function secureAttribute(environment: CookieEnvironment): string {
  return environment === "development" ? "" : "; Secure";
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (cookieHeader === null) {
    return null;
  }

  const prefix = `${name}=`;
  for (const rawPair of cookieHeader.split(";")) {
    const pair = rawPair.trim();
    if (!pair.startsWith(prefix)) {
      continue;
    }

    try {
      const value = decodeURIComponent(pair.slice(prefix.length));
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function equalInConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function createCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function buildCsrfCookie(token: string, environment: CookieEnvironment): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=86400${secureAttribute(environment)}`;
}

export function hasMatchingCsrfDoubleSubmit(request: Request): boolean {
  const cookieToken = readCookieValue(request.headers.get("cookie"), CSRF_COOKIE_NAME);
  const headerToken = request.headers.get("x-hala-csrf");
  if (cookieToken === null || headerToken === null) {
    return false;
  }

  return equalInConstantTime(cookieToken, headerToken);
}
