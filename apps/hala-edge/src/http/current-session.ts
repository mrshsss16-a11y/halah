import type { Context } from "hono";
import { IdentityRepository, type ActiveSessionIdentity } from "../adapters/d1/identity-repository";
import { hashSessionToken } from "../security/session-token";
import { readSessionToken } from "./session-cookie";
import type { HalaEnv } from "./types";

export async function resolveCurrentSession(
  context: Context<HalaEnv>
): Promise<ActiveSessionIdentity | null> {
  const rawToken = readSessionToken(context.req.header("cookie"));
  if (rawToken === null) {
    return null;
  }

  const repository = new IdentityRepository(context.env.DB);
  return repository.findActiveSession(await hashSessionToken(rawToken), new Date().toISOString());
}
