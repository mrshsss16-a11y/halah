import { Hono } from "hono";
import { CommercialRepository } from "../../adapters/d1/commercial-repository";
import {
  renderActivationPage,
  renderAuditPage,
  renderDashboardPage,
  renderLandingPage,
  renderLoginPage,
  renderProductContentPage,
  renderRecoveryPage,
  renderSignUpPage,
  renderTeamPage,
  renderSimpleAppPage
} from "../../ui/pages";
import { canStageProductContentExport } from "../commercial-authorization";
import { resolveCurrentSession } from "../current-session";
import type { HalaEnv } from "../types";

function redirectToLogin(requestUrl: string): Response {
  const loginUrl = new URL("/login", requestUrl);
  return Response.redirect(loginUrl.toString(), 302);
}

export function createUiRoutes(): Hono<HalaEnv> {
  const ui = new Hono<HalaEnv>();

  ui.get("/", (context) => context.html(renderLandingPage(context.get("cspNonce"))));
  ui.get("/signup", (context) => context.html(renderSignUpPage(context.get("cspNonce"))));
  ui.get("/login", (context) => context.html(renderLoginPage(context.get("cspNonce"))));

  ui.get("/app", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return redirectToLogin(context.req.url);
    }

    const dashboard = await new CommercialRepository(context.env.DB).loadDashboard({
      organizationId: identity.organizationId,
      organizationName: identity.organizationName
    });
    return context.html(renderDashboardPage(dashboard, context.get("cspNonce")));
  });

  const protectedPages: ReadonlyArray<
    Readonly<{ path: string; title: string; description: string; nextStep: string }>
  > = [
    {
      path: "/app/onboarding",
      title: "ابدأ تهيئة المساحة",
      description: "رتب هدفك وربط متجرك ومصادر الحقائق قبل التفعيل.",
      nextStep: "اختر خدمة محتوى المنتجات أو استرداد السلات ثم جهز بيئة سلة التجريبية."
    },
    {
      path: "/app/products",
      title: "محتوى المنتجات",
      description: "استورد facts وصوراً ثم راجع drafts قبل أي export.",
      nextStep: "ابدأ بعينة من 20 SKU حقيقية تمثل الفئات والـvariants."
    },
    {
      path: "/app/recovery",
      title: "استرداد السلات",
      description: "راجع السياسة والموافقة والميزانية قبل وصول أي حدث أو رسالة.",
      nextStep: "جهز سياسة متجر فعالة وموافقة قناة، ثم اختبر event fixtures محلياً."
    },
    {
      path: "/app/connections",
      title: "الربط",
      description: "حالة سلة وزد وواتساب تظهر هنا من دون كشف أسرار أو رموز.",
      nextStep: "سلة هي الربط الأول، وتبقى في mock/development حتى متجر demo وstaging."
    },
    {
      path: "/app/activation",
      title: "طلب التفعيل",
      description: "اطلب تفعيل الخدمة أو الاستشارة المجانية بعد اكتمال جاهزية المساحة.",
      nextStep: "أكمل onboarding ومراجعة policy قبل إرسال طلب التفعيل الداخلي."
    },
    {
      path: "/app/team",
      title: "فريق المتجر",
      description: "أدر العضويات والأدوار والدعوات المحلية ضمن مساحة متجرك.",
      nextStep: "استخدم الدعوات المحلية للاختبار فقط إلى أن يعتمد مزود البريد في staging."
    },
    {
      path: "/app/audit",
      title: "سجل التدقيق",
      description: "كل قرار مهم يجب أن يحمل سبباً ووقتاً وrequest ID داخل بيئة هالة.",
      nextStep: "ستظهر هنا نتائج imports والمراجعات والتصعيدات وعمليات التفعيل."
    }
  ];

  for (const page of protectedPages) {
    ui.get(page.path, async (context) => {
      const identity = await resolveCurrentSession(context);
      if (identity === null) {
        return redirectToLogin(context.req.url);
      }

      if (page.path === "/app/activation") {
        return context.html(
          renderActivationPage(identity.organizationName, context.get("cspNonce"))
        );
      }
      if (page.path === "/app/products") {
        return context.html(
          renderProductContentPage(
            identity.organizationName,
            canStageProductContentExport(identity.role),
            context.get("cspNonce")
          )
        );
      }
      if (page.path === "/app/recovery") {
        return context.html(
          renderRecoveryPage(
            identity.organizationName,
            identity.role === "owner",
            context.get("cspNonce")
          )
        );
      }
      if (page.path === "/app/audit") {
        return context.html(renderAuditPage(identity.organizationName, context.get("cspNonce")));
      }
      if (page.path === "/app/team") {
        return context.html(
          renderTeamPage(
            identity.organizationName,
            identity.role === "owner",
            context.get("cspNonce")
          )
        );
      }

      return context.html(
        renderSimpleAppPage({
          organizationName: identity.organizationName,
          title: page.title,
          description: page.description,
          nextStep: page.nextStep,
          cspNonce: context.get("cspNonce")
        })
      );
    });
  }

  return ui;
}
