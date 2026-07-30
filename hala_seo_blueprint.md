# خطة السيو والبيانات المهيكلة لمنصة "هالة" (Hala AI OS)

هذه الوثيقة تحتوي على المخطط الشامل لتحسين محركات البحث (SEO) وبنية البيانات المهيكلة (Schema JSON-LD) لمنصة هالة - نظام التشغيل الذكي للمتاجر الإلكترونية، مع التركيز على السوق السعودي.

## 1. العلامة التجارية والكلمات المفتاحية الافتتاحية (السوق السعودي)
- **العلامة التجارية:** هالة (Hala AI OS — نظام التشغيل الذكي للمتاجر الإلكترونية)
- **الكلمات المفتاحية الأساسية (السعودية):** إدارة المتاجر الإلكترونية، نظام الذكاء الاصطناعي للمتاجر، أتمتة التجارة الإلكترونية، هالة AI، زيادة مبيعات المتجر، منصة إدارة المتاجر السعودية، نظام هالة الذكي، تحليلات المتاجر.

---

## 2. البيانات المهيكلة (Schema JSON-LD)

تُضاف هذه البيانات في قسم `<head>` للصفحة الرئيسية والصفحات التعريفية:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://hala.ai/#software",
      "name": "هالة (Hala AI OS)",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, Windows, macOS, iOS, Android",
      "description": "نظام التشغيل الذكي للمتاجر الإلكترونية، مصمم لأتمتة التسويق، زيادة المبيعات، وإدارة العمليات التجارية بكفاءة باستخدام الذكاء الاصطناعي.",
      "softwareVersion": "1.0",
      "url": "https://hala.ai",
      "offers": {
        "@type": "Offer",
        "price": "0.00",
        "priceCurrency": "SAR",
        "availability": "https://schema.org/InStock"
      },
      "creator": {
        "@id": "https://hala.ai/#organization"
      }
    },
    {
      "@type": "Organization",
      "@id": "https://hala.ai/#organization",
      "name": "هالة (Hala)",
      "url": "https://hala.ai",
      "logo": "https://hala.ai/assets/images/logo.png",
      "sameAs": [
        "https://twitter.com/HalaAI",
        "https://linkedin.com/company/hala-ai"
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+966-000-000000",
        "contactType": "customer service",
        "areaServed": "SA",
        "availableLanguage": ["Arabic", "English"]
      }
    }
  ]
}
</script>
```

---

## 3. دراسة السيو والوسوم لكل صفحة (SEO & Meta Tags)

### 3.1 الصفحة الرئيسية (`index.html`)
- **Meta Title:** هالة (Hala AI OS) — نظام التشغيل الذكي للمتاجر الإلكترونية
- **Meta Description:** اكتشف هالة، نظام التشغيل الذكي الذي يعمل بالذكاء الاصطناعي لإدارة المتاجر الإلكترونية في السعودية. ضاعف مبيعاتك وأتمت عملياتك الآن.
- **Keywords:** هالة، Hala AI OS، نظام المتاجر الذكي، الذكاء الاصطناعي للمتاجر، التجارة الإلكترونية السعودية.
- **OpenGraph & Twitter:**
```html
<meta property="og:title" content="هالة (Hala AI OS) — نظام التشغيل الذكي للمتاجر الإلكترونية" />
<meta property="og:description" content="اكتشف هالة، نظام التشغيل الذكي الذي يعمل بالذكاء الاصطناعي لإدارة المتاجر الإلكترونية في السعودية. ضاعف مبيعاتك وأتمت عملياتك الآن." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://hala.ai/" />
<meta property="og:image" content="https://hala.ai/assets/images/og-home.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="هالة (Hala AI OS) — نظام التشغيل الذكي للمتاجر الإلكترونية" />
<meta name="twitter:description" content="ضاعف مبيعات متجرك الإلكتروني في السعودية مع هالة للذكاء الاصطناعي." />
```

### 3.2 لوحة التحكم (`dashboard.html`)
*(ملاحظة: لوحة التحكم غالباً تكون محمية من محركات البحث باستخدام `noindex` لحماية بيانات المستخدمين)*
- **Meta Title:** لوحة التحكم | هالة (Hala AI OS)
- **Meta Description:** إدارة متجرك الإلكتروني بسهولة عبر لوحة تحكم هالة المدعومة بالذكاء الاصطناعي. تابع المبيعات، العملاء، والتقارير الحية.
- **Robots:** `<meta name="robots" content="noindex, nofollow">`
- **OpenGraph & Twitter:**
```html
<meta property="og:title" content="لوحة التحكم | هالة (Hala AI OS)" />
<meta property="og:description" content="إدارة متجرك الإلكتروني بسهولة عبر لوحة تحكم هالة المدعومة بالذكاء الاصطناعي." />
```

### 3.3 تسجيل الدخول (`login.html`)
- **Meta Title:** تسجيل الدخول | هالة (Hala AI OS)
- **Meta Description:** سجل دخولك إلى منصة هالة (Hala AI OS) لبدء إدارة متجرك الإلكتروني باستخدام أحدث تقنيات الذكاء الاصطناعي.
- **Keywords:** تسجيل دخول هالة، دخول Hala AI، منصة هالة للمتاجر.
- **OpenGraph & Twitter:**
```html
<meta property="og:title" content="تسجيل الدخول | هالة (Hala AI OS)" />
<meta property="og:description" content="سجل دخولك إلى منصة هالة لإدارة متجرك الإلكتروني." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://hala.ai/login" />
```

### 3.4 طلب استشارة (`consultation.html`)
- **Meta Title:** طلب استشارة ذكية | هالة (Hala AI OS)
- **Meta Description:** احجز استشارتك الآن مع خبراء هالة (Hala AI OS). اكتشف كيف يمكن لنظام التشغيل الذكي للمتاجر الإلكترونية تحويل أعمالك في السوق السعودي.
- **Keywords:** استشارة تجارة إلكترونية، طلب استشارة هالة، تحسين المتاجر الإلكترونية، خبراء الذكاء الاصطناعي.
- **OpenGraph & Twitter:**
```html
<meta property="og:title" content="طلب استشارة ذكية | هالة (Hala AI OS)" />
<meta property="og:description" content="احجز استشارتك الآن لاكتشاف كيف يمكن لهالة مضاعفة مبيعاتك عبر الذكاء الاصطناعي." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://hala.ai/consultation" />
<meta property="og:image" content="https://hala.ai/assets/images/og-consultation.jpg" />
```
