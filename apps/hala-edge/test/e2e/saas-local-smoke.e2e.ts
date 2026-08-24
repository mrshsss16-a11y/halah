import { expect, test } from "@playwright/test";

test("creates an isolated local workspace without exposing its password in the URL", async ({
  page
}) => {
  const response = await page.goto("/signup");
  expect(response?.headers()["content-security-policy"]).toContain("'nonce-");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `e2e-owner-${unique}@example.test`;
  const password = "Synthetic-E2E-Password-2026";
  await page.getByLabel("اسم مساحة المتجر").fill(`مساحة E2E ${unique}`);
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "إنشاء المساحة" }).click();

  await expect(page).toHaveURL(/\/app$/u);
  expect(page.url()).not.toContain(password);
  await expect(page.getByRole("heading", { name: /هلا مساحة E2E/u })).toBeVisible();

  await page.goto("/app/team");
  await expect(page.getByRole("heading", { name: "أعضاء مساحة المتجر" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  await page.goto("/app/recovery");
  await expect(
    page.getByRole("heading", { name: "اختبر قرار الاسترداد قبل أي قناة" })
  ).toBeVisible();
  await expect(page.getByText(/لا تنشئ رسالة أو إرسالاً إلى واتساب/u)).toBeVisible();
});
