// ==UserScript==
// @name         TeacherPro · مرماز بالخلفية
// @namespace    teacherpro
// @version      1.0
// @description  زر ☢️ والزر الأخضر والإغلاق الجماعي بـ «اغلاق الكودات» يفتحون منصة مرماز بتبويب بالخلفية، وتبقى بصفحة TeacherPro
// @match        https://teacherpro-eight.vercel.app/*
// @run-at       document-start
// @grant        GM_openInTab
// ==/UserScript==

(function () {
  "use strict";

  // نفس الاسم بـ src/lib/code-closure-open.ts (MZ_BACKGROUND_TAB_EVENT)
  const EVENT = "teacherpro:open-background-tab";
  // ما يفتح غير منصة مرماز، حتى لو طلب الرابط شي ثاني
  const ALLOWED = /^https:\/\/www\.mz-academy\.com\//;

  document.addEventListener(EVENT, (event) => {
    const url = typeof event.detail === "string" ? event.detail : "";
    if (!ALLOWED.test(url)) return; // TeacherPro يفتحه بتبويب عادي
    // active: false = بالخلفية؛ insert: جنب تبويب TeacherPro
    GM_openInTab(url, { active: false, insert: true, setParent: true });
    event.preventDefault(); // TeacherPro يعرف إن التبويب انفتح وما يفتحه مرة ثانية
  });
})();
