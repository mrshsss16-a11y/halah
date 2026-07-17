// POST /api/stats — real, honest numbers only (no fabricated social proof —
// same rule enforced on the marketer persona itself in functions/_lib/persona.js).
import { json } from "../_lib/respond.js";

export async function onRequestPost(context) {
  const { env } = context;
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM merchants").first();
  return json({ merchantCount: (row && row.c) || 0 });
}
