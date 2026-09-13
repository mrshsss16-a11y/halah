// public/js/dashboard/pager.js — أرقام صفحات «منتجاتي» (طلب المالك 2026-09-13): بدل «عرض المزيد» الذي يطيل الصفحة بلا
// نهاية. دالة نقية بلا DOM تُختبر مباشرة: أرقام صفحات (من الصفر) و"…" بين الفجوات.
export function pageButtons(total, page, size) {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / size));
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const keep = [...new Set([0, 1, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages))].sort((a, b) => a - b);
  const out = [];
  keep.forEach((p, i) => { if (i && p - keep[i - 1] > 1) out.push("…"); out.push(p); });
  return out;
}
