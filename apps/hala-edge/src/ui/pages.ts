import type { CommercialDashboard } from "@hala/contracts";
import { escapedText, pageLayout } from "./layout";

const authScript = `<script>
  async function submitAuth(form, endpoint) {
    const message = document.getElementById('form-message');
    message.textContent = '';
    const values = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    const body = await response.json().catch(function () { return null; });
    if (!response.ok) {
      message.textContent = body && body.error ? body.error.message : 'تعذر إكمال الطلب بشكل آمن.';
      return;
    }
    window.location.assign(body.nextPath);
  }
</script>`;

function publicTopbar(): string {
  return `<header class="topbar"><a class="brand" href="/">هالة</a><nav class="actions"><a class="button secondary" href="/login">دخول</a><a class="button" href="/signup">ابدأ مساحة متجرك</a></nav></header>`;
}

function appTopbar(organizationName: string): string {
  return `<header class="topbar"><a class="brand" href="/app">هالة</a><div><strong>${escapedText(organizationName)}</strong><span class="muted"> · مساحة متجر</span></div></header>`;
}

function appNavigation(): string {
  return `<aside class="card sidebar"><strong>المساحة</strong><a href="/app">نظرة عامة</a><a href="/app/onboarding">البدء</a><a href="/app/products">محتوى المنتجات</a><a href="/app/recovery">استرداد السلات</a><a href="/app/connections">الربط</a><a href="/app/activation">تفعيل الخدمة</a><a href="/app/audit">سجل التدقيق</a><form id="logout-form"><button class="button secondary" type="submit">تسجيل خروج</button></form></aside>
<script>
  document.getElementById('logout-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  });
</script>`;
}

function appLayout(organizationName: string, pageTitle: string, content: string): string {
  return pageLayout({
    title: pageTitle,
    body: `${appTopbar(organizationName)}<section class="sidebar-layout"><section>${content}</section>${appNavigation()}</section>`
  });
}

export function renderLandingPage(): string {
  return pageLayout({
    title: "منصة قرار استرداد ومحتوى للمتاجر",
    body: `${publicTopbar()}<section class="hero"><span class="status">نسخة تجريبية محكومة</span><h1>هالة تساعد متجرك يقرر قبل ما يرسل أو ينشر.</h1><p class="muted">رتّب محتوى منتجاتك، راجع جودة صورها، وخطط لاسترداد السلات بسياسة واضحة وسجل قابل للتفسير.</p><div class="actions"><a class="button" href="/signup">أنشئ مساحة متجرك</a><a class="button secondary" href="/login">عندي حساب</a></div></section><section class="grid"><article class="card"><h2>محتوى منتجات من facts</h2><p>Drafts قابلة للمراجعة بدل وصف مبني على تخمين أو كلمات مكررة.</p></article><article class="card"><h2>صور مفهومة بحذر</h2><p>نلتقط ما يظهر ونطلب الحقيقة الناقصة، بدون اختراع خامة أو أبعاد أو ضمان.</p></article><article class="card"><h2>استرداد محكوم</h2><p>سياسة وموافقة وميزانية قبل أي رسالة، مع إيقاف واضح عند تغير الحالة.</p></article></section>`
  });
}

export function renderSignUpPage(): string {
  return pageLayout({
    title: "إنشاء مساحة متجر",
    body: `${publicTopbar()}<section class="hero"><h1>ابدأ مساحة متجرك</h1><p class="muted">أنشئ حساباً للتجربة المحلية. لا تربط متجراً أو قناة رسائل في هذه المرحلة.</p></section><section class="card" style="max-inline-size: 560px"><form id="signup-form"><label>اسم مساحة المتجر<input required name="organizationName" autocomplete="organization" minlength="2" maxlength="120" /></label><label>البريد الإلكتروني<input required type="email" name="email" autocomplete="email" maxlength="254" /></label><label>كلمة المرور<input required type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" /></label><p class="notice">استخدم كلمة مرور طويلة وفريدة. مزود البريد وتسجيل Google لا يزالان مؤجلين إلى staging.</p><p id="form-message" class="error" role="alert"></p><button class="button" type="submit">إنشاء المساحة</button></form></section><script>document.getElementById('signup-form').addEventListener('submit', function (event) { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/signup'); });</script>${authScript}`
  });
}

export function renderLoginPage(): string {
  return pageLayout({
    title: "تسجيل الدخول",
    body: `${publicTopbar()}<section class="hero"><h1>حياك في هالة</h1><p class="muted">سجل دخولك إلى مساحة متجرك.</p></section><section class="card" style="max-inline-size: 560px"><form id="login-form"><label>البريد الإلكتروني<input required type="email" name="email" autocomplete="email" maxlength="254" /></label><label>كلمة المرور<input required type="password" name="password" autocomplete="current-password" maxlength="128" /></label><p id="form-message" class="error" role="alert"></p><button class="button" type="submit">دخول</button></form><p class="muted">ما عندك مساحة؟ <a href="/signup">أنشئ حساباً</a></p></section><script>document.getElementById('login-form').addEventListener('submit', function (event) { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/login'); });</script>${authScript}`
  });
}

function readableStatus(value: string): string {
  const statuses: Record<string, string> = {
    not_connected: "غير مربوط",
    pending: "بانتظار الإعداد",
    active: "نشط",
    not_started: "لم يبدأ",
    needs_evidence: "يحتاج معلومات",
    ready_for_review: "جاهز للمراجعة",
    not_configured: "غير مهيأ",
    policy_review: "سياسة قيد المراجعة",
    ready_for_staging: "جاهز لـ staging",
    submitted: "تم الاستلام",
    reviewing: "قيد المراجعة",
    approved: "تم الاعتماد",
    declined: "لم يعتمد",
    cancelled: "ملغي"
  };
  return statuses[value] ?? "غير معروف";
}

export function renderDashboardPage(dashboard: CommercialDashboard): string {
  const activationText =
    dashboard.activationStatus === null ? "لم يُطلب" : readableStatus(dashboard.activationStatus);
  return appLayout(
    dashboard.organizationName,
    "لوحة المتجر",
    `<section><span class="status">لوحة التاجر</span><h1>هلا ${escapedText(dashboard.organizationName)}</h1><p class="muted">هذه لوحة development آمنة. ما فيه اتصال متجر أو إرسال أو نشر حي من هنا.</p><section class="grid"><article class="card"><h2>ربط المتجر</h2><p><span class="status pending">${readableStatus(dashboard.connectionStatus)}</span></p><p>ابدأ بربط سلة في بيئة تجريبية بعد تجهيز OAuth والـwebhook.</p><a class="button secondary" href="/app/connections">عرض الربط</a></article><article class="card"><h2>محتوى المنتجات</h2><p><span class="status">${readableStatus(dashboard.productContentStatus)}</span></p><p>ارفع facts وصور المنتجات، ثم راجع draft قبل أي export.</p><a class="button secondary" href="/app/products">فتح المحتوى</a></article><article class="card"><h2>استرداد السلات</h2><p><span class="status warning">${readableStatus(dashboard.recoveryStatus)}</span></p><p>سياسات وموافقة وميزانية قبل تفعيل الرسائل.</p><a class="button secondary" href="/app/recovery">فتح الاسترداد</a></article><article class="card"><h2>تفعيل الخدمة</h2><p><span class="status pending">${activationText}</span></p><p>اطلب الاستشارة والتفعيل بعد إكمال الجاهزية.</p><a class="button secondary" href="/app/activation">طلب تفعيل</a></article></section></section>`
  );
}

export function renderProductContentPage(
  organizationName: string,
  canStageExport: boolean
): string {
  const exportStageControl = canStageExport
    ? `<form id="product-export-stage-form"><p class="notice">هذه الخطوة تحفظ لقطة تدقيق داخل هالة للمسودات المحددة. لا تنشئ ملفاً جديداً ولا ترسل إلى سلة أو أي متجر.</p><p id="product-export-stage-message" class="error" role="alert"></p><button class="button secondary" type="submit">سجل تجهيز CSV للمراجعة</button></form>`
    : `<p class="notice">المالك فقط يستطيع إنشاء سجل تجهيز التصدير الداخلي. ما زالت المعاينة والتنزيل متاحين للمراجعة بحسب صلاحيتك.</p>`;

  return appLayout(
    organizationName,
    "محتوى المنتجات",
    `<section><span class="status">مسار محكوم</span><h1>استورد facts قبل كتابة أي وصف</h1><p class="muted">ارفع CSV أو الصقه هنا. هالة تتحقق من SKU وfacts والمصدر أولاً؛ لا يوجد توليد آلي أو نشر أو تحديث متجر في هذه الصفحة.</p><article class="card" style="max-inline-size: 780px"><form id="product-import-form"><label>ملف CSV اختياري<input type="file" name="csvFile" accept=".csv,text/csv" /></label><label>أو الصق محتوى CSV<textarea name="csvText" rows="12" placeholder="product_ref,sku,product_name_ar,category,facts_json,source_url"></textarea></label><label>اسم المصدر<input name="sourceName" value="منتجات-محلية.csv" maxlength="120" required /></label><p class="notice">الأعمدة المطلوبة: <code>product_ref</code> و<code>sku</code> و<code>product_name_ar</code> و<code>category</code> و<code>facts_json</code>. غياب رابط HTTPS للمصدر يوقف الصف عند «يحتاج معلومات» ولا يرسله للتوليد.</p><p id="product-import-message" class="error" role="alert"></p><pre id="product-import-report" class="notice" hidden></pre><button class="button" type="submit">فحص وحفظ facts</button></form></article><article class="card" style="max-inline-size: 780px"><h2>مراجعة الأدلة</h2><p class="muted">وجود رابط لا يكفي. راجع facts والمصدر ثم اعتمد كل SKU بقرار صريح. الاعتماد يفتح فقط مرحلة التجهيز للتوليد؛ لا ينشئ نصاً ولا ينشر شيئاً.</p><div id="evidence-review-list" aria-live="polite"><p class="muted">يجري تحميل العناصر المحتاجة مراجعة.</p></div></article><article class="card" style="max-inline-size: 780px"><h2>مسودة يدوية محكومة</h2><p class="muted">اختر facts معتمدة ثم اكتب مسودة مربوطة بخريطة الأدلة. لا تتحول إلى preview أو export من هذه الصفحة.</p><form id="product-draft-form"><label>facts المعتمدة<select id="draft-fact-id" name="factId" required><option value="">يجري تحميل facts المعتمدة…</option></select></label><pre id="draft-fact-preview" class="notice" hidden></pre><label>عنوان المسودة<input name="title" minlength="3" maxlength="120" required /></label><label>وصف قصير<textarea name="shortDescription" rows="3" minlength="20" maxlength="300" required></textarea></label><label>وصف كامل<textarea name="longDescription" rows="7" minlength="60" maxlength="3000" required></textarea></label><label>وصف ميتا<textarea name="metaDescription" rows="3" minlength="30" maxlength="180" required></textarea></label><label>خريطة الأدلة (JSON)<textarea name="evidence" rows="4" placeholder='[{"claim":"عباية سوداء","factKey":"productNameAr"}]' required></textarea></label><p class="notice">كل claim يجب أن يظهر في النص وأن يشير إلى مفتاح موجود ضمن facts المعتمدة. الادعاءات الطبية أو الضمانات غير المدعومة توقف المسودة للمراجعة.</p><p id="product-draft-message" class="error" role="alert"></p><button class="button" type="submit">فحص وحفظ المسودة</button></form></article><article class="card" style="max-inline-size: 780px"><h2>مراجعة المسودات</h2><p class="muted">لا تنتقل المسودة إلى preview إلا بقرار اعتماد صريح. الرفض يبقي القرار في سجل التدقيق ولا يحذف التاريخ.</p><div id="draft-review-list" aria-live="polite"><p class="muted">يجري تحميل المسودات الجاهزة للمراجعة.</p></div></article><article class="card" style="max-inline-size: 780px"><h2>معاينة قبل التصدير</h2><p class="muted">هذه معاينة داخل هالة للمسودات المعتمدة فقط. يمكنك تنزيل CSV لمراجعته خارجياً؛ لا يحوّل التنزيل أي بيانات إلى سلة أو أي متجر ولا يحدّثه.</p><p><a class="button secondary" href="/api/product-content/previews.csv">تنزيل CSV للمراجعة</a></p>${exportStageControl}<div id="product-preview-list" aria-live="polite"><p class="muted">يجري تحميل المعاينات المعتمدة.</p></div></article></section><script>
      document.getElementById('product-import-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('product-import-message');
        const report = document.getElementById('product-import-report');
        const values = new FormData(form);
        const selectedFile = values.get('csvFile');
        let csvText = String(values.get('csvText') || '');
        let sourceName = String(values.get('sourceName') || '').trim();
        if (selectedFile && selectedFile instanceof File && selectedFile.size > 0) {
          csvText = await selectedFile.text();
          sourceName = selectedFile.name;
        }
        message.textContent = '';
        report.hidden = true;
        report.textContent = '';
        if (!csvText.trim()) {
          message.textContent = 'اختر ملف CSV أو الصق محتواه قبل المتابعة.';
          return;
        }
        const response = await fetch('/api/product-content/imports', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sourceName: sourceName, csvText: csvText })
        });
        const body = await response.json().catch(function () { return null; });
        if (!response.ok) {
          message.textContent = body && body.error ? body.error.message : 'تعذر فحص الملف بشكل آمن.';
          if (body && body.status === 'rejected') {
            const issues = (body.errors || []).concat(body.warnings || []);
            report.textContent = issues.map(function (issue) { return 'السطر ' + issue.line + ': ' + issue.message; }).join('\\n');
            report.hidden = false;
          }
          return;
        }
        const warningCount = Array.isArray(body.warnings) ? body.warnings.length : 0;
        message.textContent = 'تم حفظ ' + body.recordCount + ' صف للمراجعة. الحالة: ' + body.status + '.';
        if (warningCount > 0) {
          report.textContent = body.warnings.map(function (warning) { return 'السطر ' + warning.line + ': ' + warning.message; }).join('\\n');
          report.hidden = false;
        }
      });

      async function loadEvidenceReviewItems() {
        const container = document.getElementById('evidence-review-list');
        const response = await fetch('/api/product-content/review-items', { credentials: 'same-origin' });
        const body = await response.json().catch(function () { return null; });
        container.textContent = '';
        if (!response.ok || !body || !Array.isArray(body.items)) {
          container.textContent = 'تعذر تحميل عناصر المراجعة بشكل آمن.';
          return;
        }
        if (body.items.length === 0) {
          container.textContent = 'لا توجد facts معلقة للمراجعة الآن.';
          return;
        }
        body.items.forEach(function (item) {
          const card = document.createElement('article');
          card.className = 'card';
          const title = document.createElement('h3');
          title.textContent = item.sku + ' · ' + item.productReference;
          const details = document.createElement('p');
          details.textContent = 'الفئة: ' + item.category;
          const facts = document.createElement('pre');
          facts.className = 'notice';
          facts.textContent = item.factsJson;
          const note = document.createElement('textarea');
          note.maxLength = 1000;
          note.placeholder = 'اكتب ملاحظة المراجعة أو سبب الاعتماد.';
          const button = document.createElement('button');
          button.className = 'button';
          button.type = 'button';
          button.textContent = 'اعتماد evidence';
          button.addEventListener('click', async function () {
            button.disabled = true;
            const approveResponse = await fetch('/api/product-content/facts/' + encodeURIComponent(item.id) + '/approve-evidence', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ reviewNote: note.value })
            });
            if (!approveResponse.ok) {
              button.disabled = false;
              button.textContent = 'تعذر الاعتماد؛ حاول بعد التحقق.';
              return;
            }
            await loadEvidenceReviewItems();
          });
          card.append(title, details, facts, note, button);
          container.append(card);
        });
      }
      async function loadApprovedFacts() {
        const select = document.getElementById('draft-fact-id');
        const preview = document.getElementById('draft-fact-preview');
        const response = await fetch('/api/product-content/approved-facts', { credentials: 'same-origin' });
        const body = await response.json().catch(function () { return null; });
        select.textContent = '';
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'اختر facts معتمدة';
        select.append(emptyOption);
        if (!response.ok || !body || !Array.isArray(body.facts)) {
          emptyOption.textContent = 'تعذر تحميل facts المعتمدة.';
          select.disabled = true;
          return;
        }
        body.facts.forEach(function (fact) {
          const option = document.createElement('option');
          option.value = fact.id;
          option.textContent = fact.sku + ' · ' + fact.productReference + ' · ' + fact.category;
          option.dataset.factsJson = fact.factsJson;
          select.append(option);
        });
        select.addEventListener('change', function () {
          const selected = select.options[select.selectedIndex];
          if (!selected || !selected.dataset.factsJson) {
            preview.hidden = true;
            preview.textContent = '';
            return;
          }
          preview.textContent = selected.dataset.factsJson;
          preview.hidden = false;
        });
      }
      document.getElementById('product-draft-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('product-draft-message');
        const values = new FormData(form);
        let evidence;
        try {
          evidence = JSON.parse(String(values.get('evidence') || ''));
        } catch {
          message.textContent = 'اكتب خريطة الأدلة بصيغة JSON صحيحة.';
          return;
        }
        const response = await fetch('/api/product-content/drafts/manual', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            factId: String(values.get('factId') || ''),
            title: String(values.get('title') || ''),
            shortDescription: String(values.get('shortDescription') || ''),
            longDescription: String(values.get('longDescription') || ''),
            metaDescription: String(values.get('metaDescription') || ''),
            evidence: evidence
          })
        });
        const body = await response.json().catch(function () { return null; });
        if (!response.ok) {
          message.textContent = body && body.error ? body.error.message : 'تعذر حفظ المسودة بشكل آمن.';
          return;
        }
        message.textContent = body.status === 'ready_for_review'
          ? 'حُفظت المسودة وهي جاهزة للمراجعة، ولم تُعرض أو تُصدّر.'
          : 'حُفظت المسودة بحالة تحتاج مراجعة: ' + (body.reasons || []).join('، ');
      });
      async function loadDraftReviewItems() {
        const container = document.getElementById('draft-review-list');
        const response = await fetch('/api/product-content/draft-review-items', { credentials: 'same-origin' });
        const body = await response.json().catch(function () { return null; });
        container.textContent = '';
        if (!response.ok || !body || !Array.isArray(body.items)) {
          container.textContent = 'تعذر تحميل المسودات للمراجعة بشكل آمن.';
          return;
        }
        if (body.items.length === 0) {
          container.textContent = 'لا توجد مسودات جاهزة للمراجعة الآن.';
          return;
        }
        body.items.forEach(function (item) {
          const card = document.createElement('article');
          card.className = 'card';
          const title = document.createElement('h3');
          title.textContent = item.title;
          const shortDescription = document.createElement('p');
          shortDescription.textContent = item.shortDescription;
          const longDescription = document.createElement('p');
          longDescription.textContent = item.longDescription;
          const meta = document.createElement('p');
          meta.textContent = 'وصف ميتا: ' + item.metaDescription;
          const evidence = document.createElement('pre');
          evidence.className = 'notice';
          evidence.textContent = item.evidenceMapJson;
          const note = document.createElement('textarea');
          note.maxLength = 1000;
          note.placeholder = 'ملاحظة قرار المراجعة.';
          const approve = document.createElement('button');
          approve.className = 'button';
          approve.type = 'button';
          approve.textContent = 'اعتماد للمعاينة';
          const reject = document.createElement('button');
          reject.className = 'button secondary';
          reject.type = 'button';
          reject.textContent = 'رفض المسودة';
          async function submitReview(decision) {
            approve.disabled = true;
            reject.disabled = true;
            const reviewResponse = await fetch('/api/product-content/drafts/' + encodeURIComponent(item.id) + '/review', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ decision: decision, reviewNote: note.value })
            });
            if (!reviewResponse.ok) {
              approve.disabled = false;
              reject.disabled = false;
              approve.textContent = 'تعذر الاعتماد؛ تحقق من المسودة.';
              return;
            }
            await loadDraftReviewItems();
          }
          approve.addEventListener('click', function () { void submitReview('approve'); });
          reject.addEventListener('click', function () { void submitReview('reject'); });
          card.append(title, shortDescription, longDescription, meta, evidence, note, approve, reject);
          container.append(card);
        });
      }
      const canStageProductExport = ${canStageExport};
      async function loadPreviewItems() {
        const container = document.getElementById('product-preview-list');
        const response = await fetch('/api/product-content/previews', { credentials: 'same-origin' });
        const body = await response.json().catch(function () { return null; });
        container.textContent = '';
        if (!response.ok || !body || !Array.isArray(body.items)) {
          container.textContent = 'تعذر تحميل المعاينات بشكل آمن.';
          return;
        }
        if (body.items.length === 0) {
          container.textContent = 'لا توجد مسودات معتمدة للمعاينة الآن.';
          return;
        }
        body.items.forEach(function (item) {
          const card = document.createElement('article');
          card.className = 'card';
          const title = document.createElement('h3');
          title.textContent = item.title;
          const shortDescription = document.createElement('p');
          shortDescription.textContent = item.shortDescription;
          const longDescription = document.createElement('p');
          longDescription.textContent = item.longDescription;
          const meta = document.createElement('p');
          meta.textContent = 'وصف ميتا: ' + item.metaDescription;
          const evidence = document.createElement('pre');
          evidence.className = 'notice';
          evidence.textContent = item.evidenceMapJson;
          if (canStageProductExport) {
            const selection = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.exportDraftId = item.id;
            selection.append(checkbox, ' تضمين هذه المسودة في سجل التجهيز');
            card.append(selection);
          }
          card.append(title, shortDescription, longDescription, meta, evidence);
          container.append(card);
        });
      }
      if (canStageProductExport) {
        document.getElementById('product-export-stage-form').addEventListener('submit', async function (event) {
          event.preventDefault();
          const message = document.getElementById('product-export-stage-message');
          const draftIds = Array.from(document.querySelectorAll('[data-export-draft-id]:checked')).map(function (element) {
            return element.dataset.exportDraftId;
          }).filter(function (draftId) { return typeof draftId === 'string'; });
          if (draftIds.length === 0) {
            message.textContent = 'اختر مسودة معتمدة واحدة على الأقل قبل تجهيز سجل المراجعة.';
            return;
          }
          const response = await fetch('/api/product-content/export-stages', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirmation: 'stage_for_export', draftIds: draftIds })
          });
          const body = await response.json().catch(function () { return null; });
          if (!response.ok || !body) {
            message.textContent = body && body.error ? body.error.message : 'تعذر حفظ سجل التجهيز بشكل آمن.';
            return;
          }
          message.textContent = 'حُفظ سجل تجهيز محلي لعدد ' + body.itemCount + ' مسودة. لا توجد عملية تصدير أو تحديث متجر.';
        });
      }
      void loadEvidenceReviewItems();
      void loadApprovedFacts();
      void loadDraftReviewItems();
      void loadPreviewItems();
    </script>`
  );
}

export function renderRecoveryPage(organizationName: string): string {
  return appLayout(
    organizationName,
    "استرداد السلات",
    `<section><span class="status warning">محاكاة محكومة</span><h1>اختبر قرار الاسترداد قبل أي قناة</h1><p class="muted">هذه محاكاة ببيانات تركيبية فقط. لا تستقبل webhook ولا تحفظ سلة ولا تنشئ رسالة أو إرسالاً إلى واتساب.</p><article class="card" style="max-inline-size: 780px"><form id="recovery-simulation-form"><label><input type="checkbox" name="allowsRecovery" checked /> السياسة الفعالة تسمح بالاسترداد</label><label><input type="checkbox" name="hasConsent" /> توجد موافقة قناة صالحة</label><label><input type="checkbox" name="isSuppressed" /> جهة الاتصال في قائمة الإيقاف</label><label><input type="checkbox" name="isCartCompleted" /> اكتمل الشراء</label><label><input type="checkbox" name="isWithinOrganizationBudget" checked /> الميزانية التشغيلية متاحة</label><label><input type="checkbox" name="isTemplateApproved" /> قالب الرسالة معتمد</label><label>عدد المحاولات السابقة<input name="attemptCount" type="number" min="0" max="3" value="0" required /></label><label>الحد الأعلى للمحاولات<input name="maxAttemptsPerCase" type="number" min="1" max="3" value="1" required /></label><p class="notice">النتيجة «مؤهل» تعني أن محرك القواعد اجتاز هذه البيانات التركيبية فقط. لا تعني أن هالة أرسلت أو ستُرسل رسالة.</p><p id="recovery-simulation-message" class="error" role="alert"></p><button class="button" type="submit">تشغيل محاكاة القرار</button></form></article></section><script>
      const recoveryReasons = {
        eligible: 'مؤهل في المحاكاة: اجتازت البيانات التركيبية كل البوابات، من دون إنشاء رسالة.',
        cart_completed: 'ممنوع: السلة مكتملة ولا يجوز الاسترداد.',
        contact_suppressed: 'ممنوع: جهة الاتصال في قائمة الإيقاف.',
        missing_consent: 'ممنوع: لا توجد موافقة قناة صالحة.',
        policy_disabled: 'ممنوع: السياسة الفعالة لا تسمح بالاسترداد.',
        attempt_cap_reached: 'ممنوع: وصل العدد إلى حد المحاولات.',
        organization_budget_exceeded: 'ممنوع: السقف التشغيلي غير متاح.',
        template_not_approved: 'ممنوع: قالب الرسالة غير معتمد.'
      };
      document.getElementById('recovery-simulation-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('recovery-simulation-message');
        const payload = {
          allowsRecovery: form.elements.allowsRecovery.checked,
          hasConsent: form.elements.hasConsent.checked,
          isSuppressed: form.elements.isSuppressed.checked,
          isCartCompleted: form.elements.isCartCompleted.checked,
          isWithinOrganizationBudget: form.elements.isWithinOrganizationBudget.checked,
          isTemplateApproved: form.elements.isTemplateApproved.checked,
          attemptCount: Number(form.elements.attemptCount.value),
          maxAttemptsPerCase: Number(form.elements.maxAttemptsPerCase.value)
        };
        const response = await fetch('/api/recovery/simulate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const body = await response.json().catch(function () { return null; });
        if (!response.ok || !body || !body.result) {
          message.textContent = body && body.error ? body.error.message : 'تعذر تشغيل المحاكاة بشكل آمن.';
          return;
        }
        message.textContent = recoveryReasons[body.result.reasonCode] || 'تعذر تفسير قرار المحاكاة.';
      });
    </script>`
  );
}

export function renderSimpleAppPage(
  input: Readonly<{
    organizationName: string;
    title: string;
    description: string;
    nextStep: string;
  }>
): string {
  return appLayout(
    input.organizationName,
    input.title,
    `<section><h1>${escapedText(input.title)}</h1><p class="muted">${escapedText(input.description)}</p><article class="card"><h2>الخطوة التالية</h2><p>${escapedText(input.nextStep)}</p><p class="notice">هذه الواجهة تعرض المسار التجاري في development. أي اتصال أو نموذج أو نشر يبقى محاكياً إلى أن يمر staging وموافقة صريحة.</p></article></section>`
  );
}

export function renderActivationPage(organizationName: string): string {
  return appLayout(
    organizationName,
    "طلب التفعيل",
    `<section><h1>طلب تفعيل هالة</h1><p class="muted">اختر الخدمة التي تريد تجهيزها. يبدأ التفعيل بمراجعة الجاهزية واستشارة مجانية، ولا ينفذ أي ربط أو إرسال من هذه الصفحة.</p><article class="card" style="max-inline-size: 620px"><form id="activation-form"><label>الخدمة المطلوبة<select name="requestedService" required><option value="product_content">محتوى المنتجات والصور</option><option value="cart_recovery">استرداد السلات المحكوم</option><option value="both">الخدمتان معاً</option></select></label><label>ملاحظة اختيارية<textarea name="notes" maxlength="1000" placeholder="اكتب هدفك أو نوع المتجر أو ما تريد ترتيبه أولاً."></textarea></label><p id="activation-message" class="error" role="alert"></p><button class="button" type="submit">إرسال طلب التفعيل</button></form></article></section><script>
  document.getElementById('activation-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const message = document.getElementById('activation-message');
    message.textContent = '';
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch('/api/activation/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
    const body = await response.json().catch(function () { return null; });
    if (!response.ok) { message.textContent = body && body.error ? body.error.message : 'تعذر إرسال الطلب بشكل آمن.'; return; }
    message.textContent = 'تم استلام طلبك. ستظهر حالته في لوحة هالة بعد المراجعة.';
  });
</script>`
  );
}
