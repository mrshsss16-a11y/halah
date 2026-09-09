// shim مؤقت — يُزال بالمرحلة ٦؛ الاستيرادات الجديدة من domain/* مباشرة.
// المرحلة ٣ نقلت هذا الملف إلى `functions/_lib/domain/sallaProductPayload.js` بلا أي تغيير
// سلوكي (ARCHITECTURE.md §٢: «services/* → domain/* بـre-export مؤقت»).

export {
  composeDescriptionHtml,
  buildSallaProductFields
} from "../domain/sallaProductPayload.js";
