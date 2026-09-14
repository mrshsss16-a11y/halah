// public/js/dashboard/notes.js — «وش يميز منتجاتك؟» قبل تحليل الصور (طلب المالك 2026-09-14).
//
// بعد تحديد المنتجات وقبل التوليد: سطر اختياري لكل منتج (الخامة، المصدر، الضمان، سبب الطلب عليه).
// الصورة لا تُظهر «قطن مصري» ولا «عسل سدر أصلي» — التاجر يعرفها، والوصف يبني زاويته التسويقية عليها.
// البناء بـcreateElement/textContent لا innerHTML: الأسماء والروابط من سلة.
const $ = (id) => document.getElementById(id);
const NOTE_MAX = 300;
let onStart = null;

/** يفتح النافذة لقائمة { sku, name, imageUrl } و`start(notes)` يُستدعى عند «ابدأ الوصف». */
export function openNotesModal(items, start) {
  const list = $("notesList");
  // صفحة HTML قديمة من الكاش بلا النافذة: لا نكسر التوليد — نبدأ بلا أسطر (بلاغ المالك 2026-09-14 «ما عاد يولد شي»).
  if (!list || !$("notesModal") || !$("notesQuota")) { start({}); return; }
  onStart = start;
  list.replaceChildren(...items.map(noteRow));
  $("notesQuota").innerText = `المحدد ${items.length} — ما زاد عن حد اليوم يتأجل لبكرة تلقائياً`;
  $("notesModal").classList.remove("hidden");
  list.querySelector("textarea")?.focus();
}

function noteRow(it) {
  const row = document.createElement("div");
  row.className = "flex items-start gap-3 p-3 rounded-2xl border border-slate-200";
  const img = document.createElement("img");
  img.className = "w-14 h-14 rounded-xl object-contain bg-slate-50 border border-slate-200 shrink-0";
  img.referrerPolicy = "no-referrer";
  img.alt = "";
  if (it.imageUrl) img.src = it.imageUrl; else img.classList.add("hidden");
  const body = document.createElement("div");
  body.className = "flex-1 min-w-0 space-y-1";
  const name = document.createElement("label");
  name.className = "block text-sm font-black text-black truncate";
  name.textContent = it.name || it.sku;
  const input = document.createElement("textarea");
  input.rows = 2;
  input.maxLength = NOTE_MAX;
  input.dataset.sku = it.sku;
  input.id = `note_${it.sku}`.replace(/[^\w-]/g, "_");
  name.htmlFor = input.id;
  input.placeholder = "وش يميز هالمنتج؟ (اختياري) — مثال: قطن مصري ١٠٠٪، خياطة يدوية، مناسب للصيف";
  input.className = "w-full bg-white border border-slate-300 text-xs rounded-xl p-3 text-black font-medium focus:outline-none focus:border-black";
  body.append(name, input);
  row.append(img, body);
  return row;
}

export function closeNotesModal() {
  $("notesModal")?.classList.add("hidden");
  onStart = null;
}

/** «ابدأ الوصف» — يجمع الأسطر غير الفارغة ويسلّمها لمسار البدء. */
export function confirmNotes() {
  const notes = {};
  $("notesList").querySelectorAll("textarea[data-sku]").forEach((el) => {
    const v = el.value.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
    if (v) notes[el.dataset.sku] = v;
  });
  const start = onStart;
  closeNotesModal();
  if (start) start(notes);
}
