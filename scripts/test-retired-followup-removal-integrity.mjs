#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
let failed = false;
const check = (condition, message) => {
  if (condition) console.log(`✅ ${message}`);
  else {
    failed = true;
    console.error(`❌ ${message}`);
  }
};

const layout = read("src/components/teacher-pro/layout.tsx");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const accounts = read("src/components/teacher-pro/accounts.tsx");
const dismissedManagement = read("src/components/teacher-pro/dismissed-management.tsx");
const store = read("src/lib/teacher-store.ts");
const serverAuth = read("src/lib/server-auth.ts");
const api = read("src/lib/api.ts");
const stats = read("src/app/api/stats/route.ts");
const studentNotes = read("src/app/api/student-notes/route.ts");
const profileStats = read("src/app/api/students/profile-stats/route.ts");
const profileLog = read("src/app/api/students/profile-log/route.ts");
const dismissedHistory = read("src/app/api/dismissed-management/history/route.ts");
const compatibility = read("src/lib/retired-followup-compat.ts");
const language = read("src/lib/teacherpro-language.ts");
const engine = read("src/lib/academic-engine.ts");

check(
  !exists("src/app/api/student-notes/pledges/route.ts") &&
    !exists("src/app/api/student-notes/pledge-stats/route.ts") &&
    !exists("scripts/test-pledges-integrity.mjs") &&
    !exists("scripts/preview-pledge-repair.mjs") &&
    !exists("scripts/repair-final-pledge-two-opportunities.mjs"),
  "مسارات التعهد واختباراته وسكربتات إصلاحه القديمة محذوفة نهائياً",
);

check(
  !followUp.includes("FollowUpPledgesView") &&
    !followUp.includes("pledgeApi") &&
    !followUp.includes("Pledge") &&
    !api.includes("pledgeApi") &&
    !api.includes("Pledge"),
  "واجهة المتابعة وعميل API لا يحتويان على ميزة التعهد",
);

check(
  !layout.includes('id: "follow-up-pledges"') &&
    layout.includes("if (value === 'follow-up-pledges') return 'dismissed-management'") &&
    store.includes('state.currentSection === "follow-up-pledges"'),
  "الروابط المحفوظة القديمة تُحوّل بأمان إلى إدارة المفصولين دون إظهار تبويب",
);

check(
  !store.includes("follow-up.pledges") &&
    !serverAuth.includes("follow-up.pledges") &&
    !accounts.includes("follow-up.pledges"),
  "صلاحيات التعهد محذوفة من المتجر والخادم وإدارة الحسابات",
);

check(
  !dismissedManagement.includes("pledgeFilter") &&
    !dismissedManagement.includes("withPledge") &&
    !dismissedManagement.includes("withoutPledge") &&
    !stats.includes("PLEDGE_NOTE_KIND") &&
    !stats.includes("pledgeCount"),
  "إدارة المفصولين ولوحة المعلومات لا تحتويان على فلتر أو تنبيه أو إحصاء تعهد",
);

check(
  compatibility.includes('RETIRED_FOLLOWUP_NOTE_KIND = "تعهد ولي الأمر"') &&
    studentNotes.includes("kind: { not: RETIRED_FOLLOWUP_NOTE_KIND }") &&
    studentNotes.includes("data.kind === RETIRED_FOLLOWUP_NOTE_KIND") &&
    studentNotes.includes("updates.kind ??") &&
    studentNotes.match(/isRetiredFollowupNote\(existing\)/g)?.length === 2 &&
    profileStats.includes("kind: { not: RETIRED_FOLLOWUP_NOTE_KIND }") &&
    profileLog.includes("kind: { not: RETIRED_FOLLOWUP_NOTE_KIND }") &&
    dismissedHistory.includes("kind: { not: RETIRED_FOLLOWUP_NOTE_KIND }"),
  "السجلات التاريخية محفوظة لكنها مخفية، والكتابة الجديدة مرفوضة",
);

check(
  engine.includes('log.action === "رصيد بعد تعهد"') &&
    compatibility.includes("displayOpportunityAction") &&
    language.includes('[/تعهد/g, "إعادة تفعيل"]'),
  "التوافق الحسابي القديم محفوظ مع تنقية النصوص المعروضة للمستخدم",
);

if (failed) {
  console.error("\nفشل اختبار حذف ميزة التعهد المتقاعدة.");
  process.exit(1);
}

console.log("\nكل اختبارات حذف ميزة التعهد المتقاعدة نجحت.");
