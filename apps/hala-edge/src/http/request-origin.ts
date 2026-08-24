export function hasTrustedSameOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader === null) {
    return false;
  }

  try {
    return new URL(originHeader).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
