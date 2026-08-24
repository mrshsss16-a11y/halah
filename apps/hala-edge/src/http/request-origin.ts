import { hasMatchingCsrfDoubleSubmit } from "../security/csrf";

export function hasTrustedBrowserMutation(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader === null) {
    return false;
  }

  try {
    return (
      new URL(originHeader).origin === new URL(request.url).origin &&
      hasMatchingCsrfDoubleSubmit(request)
    );
  } catch {
    return false;
  }
}
