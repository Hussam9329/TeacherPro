import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const syncLib = read("src/lib/teacherpro-sync.ts");
const syncHook = read("src/hooks/use-teacherpro-sync.ts");
const layout = read("src/components/teacher-pro/layout.tsx");
const store = read("src/lib/teacher-store.ts");
const missingNotes = read("src/components/teacher-pro/missing-students-notes.tsx");
const calls = read("src/components/teacher-pro/follow-up.tsx");

const checks = [
  [
    "التعديل المحلي لا يعيد إطلاق نفس حدث المزامنة داخل التبويب الحالي",
    syncLib.includes('source !== "local-mutation"') &&
      syncLib.includes("shouldDispatchLocally"),
  ],
  [
    "التعديل المحلي يبقى مبثوثاً للتبويبات الأخرى عبر BroadcastChannel وstorage",
    syncLib.includes("getBroadcastChannel()?.postMessage(detail)") &&
      syncLib.includes("TEACHERPRO_DATA_CHANGED_STORAGE_KEY"),
  ],
  [
    "كل تبويب يملك Context ID لمنع استقبال صدى حدثه نفسه",
    syncLib.includes("originContextId") &&
      syncLib.includes("getTeacherProSyncContextId"),
  ],
  [
    "فحص نسخة الخادم يستهلك صدى التعديلات المحلية مع إبقاء النطاقات الخارجية",
    syncLib.includes("consumeTeacherProLocalMutationEcho") &&
      layout.includes("externalScopes"),
  ],
  [
    "فحص نسخة قاعدة البيانات صار كل 10 ثوانٍ ويتوقف عند إخفاء التبويب",
    layout.includes("10_000") &&
      layout.includes("document.hidden"),
  ],
  [
    "حدث server-version لا يعاد بثه لكل التبويبات لمنع حلقة مزامنة جديدة",
    layout.includes('source: "server-version"') &&
      layout.includes("broadcast: false"),
  ],
  [
    "الصفحات ذات الاستعلامات الخاصة تملك مالك تحديث واحد ولا يعيد Layout تحميلها",
    layout.includes("PAGE_OWNED_SYNC_SECTIONS") &&
      layout.includes("if (PAGE_OWNED_SYNC_SECTIONS.has(currentSection)) return;"),
  ],
  [
    "التحديث الخارجي يُدمج ويؤجل أثناء الكتابة أو السكرول بدلاً من مقاطعة المستخدم",
    syncHook.includes("EXTERNAL_SYNC_DEBOUNCE_MS") &&
      syncHook.includes("isTeacherProInteractionBusy") &&
      syncHook.includes("MAX_INTERACTION_DEFERRAL_MS"),
  ],
  [
    "يوجد تنبيه غير حاجب مع خيار تطبيق التحديث الآن",
    syncHook.includes("announceTeacherProSyncPending") &&
      layout.includes('label: "تطبيق الآن"'),
  ],
  [
    "طلبات تحميل الـStore تطبق قاعدة latest-request-wins",
    store.includes("loadAllRequestSequence") &&
      store.includes("sectionLoadRequestSequence") &&
      store.includes("requestSequence !== loadAllRequestSequence"),
  ],
  [
    "صفحة ملاحظات الطلاب لا تستمع لكل تغييرات localStorage بلا فلترة",
    !missingNotes.includes('addEventListener("storage"'),
  ],
  [
    "طلبات المكالمات القديمة لا تستبدل حالة تم الاتصال المحفوظة",
    calls.includes("mutationVersionAtRequestStart") &&
      calls.includes("callMutationVersionRef.current"),
  ],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`✅ ${label}`);
  else {
    failed += 1;
    console.error(`❌ ${label}`);
  }
}

if (failed) {
  console.error(`\nفشل ${failed} من اختبارات Smart Sync.`);
  process.exit(1);
}

console.log("\nكل اختبارات Smart Sync الجذرية نجحت.");
