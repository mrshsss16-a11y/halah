import { cleanInputMessage } from "./typoCorrector.js";

// Aura's own first-touch greeting — distinct from the generic `greeting`
// intent below because it names Hala and Aura explicitly. Only meant to be
// used on Aura's own support line (isAuraLine), never for a merchant's
// connected number (a merchant's customer should hear the MERCHANT's name,
// not "Aura").
export function matchAuraGreeting(text) {
  if (!text) return null;
  const cleanedText = cleanInputMessage(text);
  const t = cleanedText.trim().toLowerCase();
  const keywords = ["السلام عليكم", "هلا", "مرحبا", "صباح الخير", "مساء الخير", "السلام", "هاي", "هلو"];
  if (!keywords.some((kw) => t.includes(kw))) return null;
  return "هلا هلا! أنا هالة، مساعدة عملاء أورا للتسويق. كيف أقدر أخدمك اليوم؟";
}

/**
 * @param {string} text
 * @param {string} dialect
 * @param {{ greetingOnly?: boolean }} [opts] - `greetingOnly` restricts matching
 *   to the `greeting` intent only. The other intents here (delivery times,
 *   Tamara/Tabby, seasonal offers) hardcode claims that don't hold for every
 *   merchant's store — auto-answering them for an arbitrary connected merchant
 *   number would risk fabricating details (honesty rule, AGENT.md §11). Only
 *   greeting is safe to auto-answer for any merchant without per-store setup.
 */
export function matchFastIntent(text, dialect = "saudi_najdi", opts = {}) {
  if (!text) return null;
  const cleanedText = cleanInputMessage(text);
  const t = cleanedText.trim().toLowerCase();

  const allIntents = {
    greeting: {
      keywords: ["السلام عليكم", "هلا", "مرحبا", "صباح الخير", "مساء الخير", "السلام"],
      responses: {
        saudi_najdi: "يا هلا ومسهلا! وعليكم السلام والرحمة. آمرني، كيف أقدر أخدمك اليوم؟",
        saudi_hijazi: "يا هلا والله! وعليكم السلام. تفضل، كيف أقدر أساعدك؟",
        general: "وعليكم السلام ورحمة الله وبركاته، أهلاً بك. كيف يمكنني مساعدتك؟"
      }
    },
    delivery: {
      keywords: ["توصيل", "متى يوصل", "شحن", "كم التوصيل", "تاخير"],
      responses: {
        saudi_najdi: "أبشر! التوصيل ياخذ عادة من يومين إلى خمسة أيام عمل. عندك طلب معين تبي تشيك عليه؟",
        saudi_hijazi: "أبشر من عيوني! التوصيل ياخذ من يومين لخمسة أيام. تبغاني أشيك لك على طلب؟",
        general: "التوصيل يستغرق عادة من 2 إلى 5 أيام عمل. هل ترغب في تتبع طلب معين؟"
      }
    },
    working_hours: {
      keywords: ["اوقات العمل", "متى تفتحون", "مواعيدكم", "ساعات العمل", "تفتحون"],
      responses: {
        saudi_najdi: "حنا بالخدمة من الأحد للخميس، من 9 الصبح لين 5 العصر.",
        saudi_hijazi: "احنا في خدمتك من الأحد للخميس، من الساعة 9 الصباح إلين 5 العصر.",
        general: "أوقات العمل لدينا من الأحد إلى الخميس، من الساعة 9 صباحاً حتى 5 مساءً."
      }
    },
    location: {
      keywords: ["وينكم", "موقعكم", "فرعكم", "الفروع", "مكانكم"],
      responses: {
        saudi_najdi: "حالياً حنا متجر إلكتروني ونوصل لكل مناطق المملكة، ما عندنا فروع على الأرض.",
        saudi_hijazi: "حالياً إحنا متجر إلكتروني ونوصل لكل مكان في المملكة، ما عندنا فروع حالياً.",
        general: "نحن متجر إلكتروني ونوفر خدمة التوصيل لجميع مناطق المملكة، وليس لدينا فروع فعلية حالياً."
      }
    },
    tamara_tabby: {
      keywords: ["تمارا", "تابي", "تقسيط", "الدفع الاجل", "4 دفعات"],
      responses: {
        saudi_najdi: "أبشر! تقدر تقسط مشترياتك على 4 دفعات بدون فوائد أو رسوم إضافية عبر تمارا أو تابي. كمل طلبك وسلتك تنتظرك! 🎁",
        saudi_hijazi: "يا أهلاً! تقدر تقسط مشترياتك على 4 دفعات بدون فوائد عبر تمارا وتابي، كمل طلبك والخير يوصلك! ✨",
        general: "يمكنك تقسيط مشترياتك على 4 دفعات بدون فوائد عبر تمارا وتابي."
      }
    },
    saudi_season: {
      keywords: ["يوم التأسيس", "اليوم الوطني", "رمضان", "العيد", "عروض"],
      responses: {
        saudi_najdi: "هلا بالزين! عروضنا الموسمية الخاصة بـ يوم التأسيس واليوم الوطني ورمضان جاهزة وبخصومات استثنائية! 🎉",
        saudi_hijazi: "يا أهلاً! عروضنا الموسمية بمناسبة التأسيس واليوم الوطني ورمضان موجودة ومتاحة الآن! ✨",
        general: "عروضنا الموسمية متوفرة الآن بخصومات متميزة."
      }
    },
    emotional_cart_recovery: {
      keywords: ["بخاطرك", "سلتك", "نسيت", "ما يرضينا", "سلة متروكة", "القسط الشهري"],
      responses: {
        saudi_najdi: "يا أهلاً! 🤍 شفنا المنتجات في سلتك أمس.. وما يرضينا صراحة تظل بخاطرك وما تجربها! ✨ وفوقها مع تمارا أو تابي تقدر تقسطها على 4 دفعات وتدفع بس من 30 إلى 50 ريال بالشهر! 🎁",
        saudi_hijazi: "يا هلا والله! 🤍 شفناك أضفت المنتجات لسلتك وما كملت الشراء.. وما يرضينا تظل بخاطرك! مع تمارا وتابي تقدر تقسطها بـ 30 أو 50 ريال بالشهريات! ✨",
        general: "أهلاً بك! يمكنك إكمال طلبك وتقسيط المبلغ على 4 دفعات بدون فوائد عبر تمارا وتابي."
      }
    }
  };

  const intents = opts.greetingOnly ? { greeting: allIntents.greeting } : allIntents;

  const getResponse = (responses, d) => responses?.[d] ?? responses?.saudi_najdi ?? responses?.general;

  for (const [intentName, intentData] of Object.entries(intents)) {
    for (const kw of intentData.keywords) {
      if (t.includes(kw)) {
        return getResponse(intentData.responses, dialect);
      }
    }
  }

  return null;
}
