// shim مؤقت — يُزال بالمرحلة ٦؛ الاستيرادات الجديدة من domain/* مباشرة.
// المرحلة ٣ نقلت هذا الملف إلى `functions/_lib/domain/publish.js` بلا أي تغيير
// سلوكي (ARCHITECTURE.md §٢: «services/* → domain/* بـre-export مؤقت»).

export {
  publishApproved
} from "../domain/publish.js";
