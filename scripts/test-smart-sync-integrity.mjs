import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const syncLib = read("src/lib/teacherpro-sync.ts");
const syncHook = read("src/hooks/use-teacherpro-sync.ts");
const layout = read("src/components/teacher-pro/layout.tsx");
const store = read("src/lib/teacher-store.ts");
const calls = read("src/components/teacher-pro/follow-up.tsx");
const versionRoute = read("src/app/api/sync/version/route.ts");
const smartNotesServer = read("src/lib/grade-smart-notes-server.ts");
const syncMarkersMigration = read(
  "prisma/migrations/20261019120000_sync_change_markers/migration.sql",
);
const versionScopeKeys = [
  "courses", "chapters", "courseChapters", "students", "exams", "grades",
  "opportunityLogs", "studentLeaves", "studentCalls", "studentNotes",
  "users", "roles", "auditLogs", "gradeSmartNotes",
];
const silentRepairEndpoints = [
  "/api/students/academic-repair",
  "/api/students/fix-zero-opportunities",
  "/api/students/clamp-opportunities",
];

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
    "فحص نسخة بيانات النظام دوري ويتوقف عند إخفاء التبويب",
    layout.includes("12_000") &&
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
      syncHook.includes("getTeacherProInteractionState") &&
      syncHook.includes("interaction.hard") &&
      syncHook.includes("MAX_INTERACTION_DEFERRAL_MS"),
  ],
  [
    "تحديثات الخلفية لا تقاطع المستخدم وتبقى مؤجلة أثناء التفاعل",
    syncHook.includes("announceTeacherProSyncPending") &&
      layout.includes("Background sync notifications are intentionally suppressed") &&
      !layout.includes('label: "تطبيق الآن"'),
  ],
  [
    "طلبات تحميل الـStore تطبق قاعدة latest-request-wins",
    store.includes("loadAllRequestSequence") &&
      store.includes("sectionLoadRequestSequence") &&
      store.includes("requestSequence !== loadAllRequestSequence"),
  ],
  [
    "تحميل بيانات النظام لا ينفذ إصلاحاً أكاديمياً صامتاً أو يكتب قاعدة البيانات",
    !store.includes("triggerAutoFixZeroOpportunities") &&
      !store.includes("repairAbsentDiscountAccountingIfNeeded") &&
      !store.includes("ACADEMIC_REPAIR_FLAG") &&
      silentRepairEndpoints.every((endpoint) => !store.includes(endpoint)),
  ],
  [
    "طلبات المكالمات القديمة لا تستبدل حالة تم الاتصال المحفوظة",
    calls.includes("mutationVersionAtRequestStart") &&
      calls.includes("callMutationVersionRef.current"),
  ],
  [
    "النوافذ المفتوحة والعمليات الجارية تمنع التحديث الخارجي القسري",
    syncLib.includes("hasOpenTeacherProDialog") &&
      syncLib.includes("explicitInteractionBlockers") &&
      syncLib.includes("beginTeacherProInteractionBlocker"),
  ],
  [
    "التحميل الكامل محصور بأول اتصال وتحديثات الخلفية لا تعرض شاشة تحميل عامة",
    store.includes("const isInitialLoad = !get().dbConnected") &&
      store.includes("announceTeacherProSyncRefreshing"),
  ],
  [
    "حالة المزامنة موحدة داخل واجهة النظام",
    layout.includes("TEACHERPRO_SYNC_STATUS_EVENT") &&
      layout.includes("setSyncStatus(detail)"),
  ],
  [
    "فحص نسخة الخادم لا يعدّ جداول كاملة بل يقرأ مؤشرات التغيير",
    !/COUNT\(\*\)\s+FROM\s+"(?!SyncChange|old)/i.test(versionRoute) &&
      !/MAX\("(?:updatedAt|time)"\)/.test(versionRoute) &&
      versionRoute.includes('FROM "SyncVersion"') &&
      versionRoute.includes('FROM "SyncChange"'),
  ],
  [
    "كل نطاق في خريطة المزامنة يملك مؤشر تغيير تكتبه Triggers قاعدة البيانات",
    versionScopeKeys.every(
      (key) =>
        layout.includes(`${key}: [`) &&
        syncMarkersMigration.includes(`'${key}'`),
    ) &&
      syncMarkersMigration.includes("AFTER INSERT") &&
      syncMarkersMigration.includes("AFTER UPDATE") &&
      syncMarkersMigration.includes("AFTER DELETE"),
  ],
  [
    "إعادة كتابة صف بنفس القيم أو إعادة حفظ نفس الملاحظة الذكية لا تُعد تغييراً",
    syncMarkersMigration.includes(`(to_jsonb(n) - 'updatedAt') IS DISTINCT FROM (to_jsonb(o) - 'updatedAt')`) &&
      smartNotesServer.includes("existing.status === input.status &&") &&
      smartNotesServer.includes("existing.reason === input.reason &&"),
  ],
  [
    "ترحيل مؤشرات التغيير إضافي فقط ولا يحذف أو يعدّل بيانات قائمة",
    !/\b(?:DROP\s+(?:TABLE|COLUMN)|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+")/i.test(
      syncMarkersMigration,
    ),
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
