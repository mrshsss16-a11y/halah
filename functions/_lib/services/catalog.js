// shim مؤقت — يُزال بالمرحلة ٦؛ الاستيرادات الجديدة من domain/* مباشرة.
// المرحلة ٣ نقلت هذا الملف إلى `functions/_lib/domain/catalog.js` بلا أي تغيير
// سلوكي (ARCHITECTURE.md §٢: «services/* → domain/* بـre-export مؤقت»).

export {
  syncCatalogPage,
  listCatalog,
  getCatalogItem,
  findCatalogBySallaProductId,
  countCatalog,
  listPriorityCatalog,
  selectCatalogBySkus,
  markPublished,
  markReverted,
  getCatalogSyncState
} from "../domain/catalog.js";
