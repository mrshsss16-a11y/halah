// shim مؤقت — يُزال بالمرحلة ٦؛ الاستيرادات الجديدة من domain/* مباشرة.
//
// كان هذا الملف ١٣٥٠ سطراً و٨٤ تصديراً وتسعة مجالات (docs/ARCHITECTURE.md §١).
// المرحلة ٣ نقلت كل استعلام مجالي إلى `functions/_lib/domain/*` بلا أي تغيير
// سلوكي (نفس SQL، نفس الرسائل، نفس شروط merchant_id). ما بقي هنا: **إعادة
// تصدير فقط**، حتى لا يتغير أي من الأربعين مستورداً بهذه المرحلة.
//
// ⚠️ لا تُضف دالة جديدة هنا. أضفها بمجالها تحت `domain/` واستوردها من هناك.
// (استيراد core/db.js لـdomain/* يخالف قاعدة الاتجاه ق١؛ الاستثناء مسجَّل
//  بـscripts/audit-layering.mjs كاستثناء shim مؤقت ينتهي بالمرحلة ٦.)

export { getMerchant, getAccountEmail, listAccounts, setAccountDisabled, isAccountDisabled,
         GOOGLE_MERCHANT_PREFIX, lookupAccountForGoogle, normalizeEmailForDedupe, trialSeatUsage }
  from "../domain/accounts.js";

export { isLoginLocked, recordLoginFailure, clearLoginAttempts,
         isResetOtpLocked, recordResetOtpFailure, clearResetOtpAttempts, attemptGuard }
  from "../domain/auth.js";

export { getMerchantBySalla, upsertMerchantFromSalla, saveTokens, getTokens,
         acquireRefreshLock, releaseRefreshLock, getValidSallaToken,
         revokeSallaConnection, getSallaConnectionState }
  from "../domain/salla.js";

export { recordWaInbound, recordWaOutbound, getLastHumanReplyAt,
         countRecentInboundWithoutResolution, isWaWindowOpen, recentWaHistory,
         recentWaConversations, getWaConnectionByPhoneId, getWaConnectionByMerchant,
         saveWaConnection }
  from "../domain/whatsapp.js";

export { listHalaFaq, saveHalaFaqEntry, deleteHalaFaqEntry,
         listMerchantFaqs, saveMerchantFaq, deleteMerchantFaq }
  from "../domain/faq.js";

export { getIgConnectionByUserId, claimIgEvent } from "../domain/instagram.js";

export { createBulkJob, getBulkJob, listActiveBulkJobItems, completeBulkJobItem,
         getActiveJobByKind, createCatalogSyncJob, claimNextCatalogSyncJob,
         advanceCatalogSyncJob, failCatalogSyncJob, DEFERRED_MARKER,
         listMerchantsWithDeferredItems, reviveDeferredItems }
  from "../domain/bulk.js";

export { saveConsultationBooking, listConsultationBookings, setBookingStatus }
  from "../domain/booking.js";

export { adminStats, launchStats, saveMerchantFeedback, listMerchantFeedback,
         listMerchantActivity }
  from "../domain/analytics.js";

export { resetMerchantQuota } from "../domain/quota.js";

export { recentCopy, saveCopy } from "../domain/copy.js";

export { saveOmnichannelSession, getOmnichannelSession } from "../domain/conversation.js";

export { getAgentProfile, saveAgentProfile, getMarketingContext, saveMarketingContext,
         getStoreLogo, saveStoreLogo }
  from "../domain/persona.js";

export { logWebhook, saveAbandonedCart, listAbandonedCarts,
         getPlatformConnection, savePlatformConnection }
  from "../domain/platforms.js";
