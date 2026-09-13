// بريد التواصل الرسمي (2026-09-13): info@aura.sa بدل Gmail الشخصي — بالصفحات العامة والرسائل ووثائق PDPL.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("contact-email");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FILES = ["../../privacy.html", "../../terms.html", "../../faq.html", "../../data-deletion.html", "../../docs/PDPL/ROPA.md", "../../docs/PDPL/BREACH_RESPONSE.md", "../../functions/api/auth/forgot_password.js", "../../functions/_lib/domain/sallaAccountLink.js"];

async function main() {
  for (const f of FILES) {
    const text = read(f);
    assert(!/@gmail\.com/i.test(text), `CE-1: لا بريد Gmail في ${f.replace("../../", "")}`);
    assert(text.includes("info@aura.sa"), `CE-2: ${f.replace("../../", "")} يذكر info@aura.sa`);
  }
}

main().then(done);
