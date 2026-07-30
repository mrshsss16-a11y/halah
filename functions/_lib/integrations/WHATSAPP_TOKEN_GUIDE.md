# 🟢 دليل تفعيل توكن الواتساب الدائم (Meta Permanent System User Token)

## 📌 المشكلة:
التوكن المؤقت (Temporary Access Token) المأخوذ من واجهة التطوير (Meta Developer Dashboard) ينتهي مفعوله تلقائياً بعد **ساعة واحدة فقط**، مما يتسبب في توقف محاكي ورسائل الواتساب.

---

## 🛠️ الخطوات التفصيلية للحصول على التوكن الدائم (الذي لا ينتهي أبداً):

1. **الذهاب لإعدادات أعمال فيسبوك (Meta Business Settings)**:
   - افتح [Meta Business Settings](https://business.facebook.com/settings).
   - اختر حساب الأعمال الخاص بمتجرك/شركتك.

2. **إنشاء مستخدم نظام (System User)**:
   - من القائمة الجانبية: اختر **Users** ➔ **System Users**.
   - اضغط على **Add**.
   - اسم المستخدم: `Hala-AI-OS-Bot`
   - الدور (System User Role): اختر **Admin**.

3. **تعيين الأذونات والتطبيقات (Assign Assets)**:
   - اضغط على **Assign Assets**.
   - اختر تطبيقك (WhatsApp Cloud API App).
   - فعّل خيار **Full Control** (التحكم الكامل).

4. **توليد التوكن الدائم (Generate Token)**:
   - اضغط على زر **Generate New Token**.
   - اختر التطبيق المربوط بالواتساب.
   - حدد مدة الانتهاء (Token Expiry): اختر **Never** (لا ينتهي أبداً).
   - اختر الصلاحيات الإجبارية التالية (Permissions):
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
   - اضغط **Generate Token** وقم بنسخ التوكن الناتج.

5. **تحديث التوكن في لوحة Cloudflare Pages**:
   - افتح لوحة مشروعك في Cloudflare Pages.
   - اذهب إلى **Settings** ➔ **Environment Variables**.
   - أضف المتغير: `WHATSAPP_TOKEN` وضع القيمة الجديدة للـ Permanent Token.
   - اضغط **Save and Deploy**.

---

🔗 **الرابط الرسمي لوثائق فيسبوك وميتا:** [Meta WhatsApp Business Access Tokens Guide](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started)
