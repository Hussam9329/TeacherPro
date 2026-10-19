#!/usr/bin/env node
// End-to-end check of /api/student-app/* against a running local server with
// the seed from seed-student-app-local.mjs. Read-only apart from device rows.
const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
// A fresh forwarded address per run keeps the per-IP login bucket from a previous run out of the way.
const RUN_IP = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let failed = false;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => { failed = true; console.log(`FAIL: ${m}`); };
const check = (cond, m) => (cond ? pass(m) : fail(m));
const call = async (path, { method = "GET", body, token } = {}) => {
  const res = await fetch(`${BASE}/api/student-app${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": RUN_IP, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = async (phone, code) => {
  const step1 = await call("/login", { method: "POST", body: { phone, code } });
  if (step1.status !== 200) return { step1 };
  const step2 = await call("/login/confirm", { method: "POST", body: { ticket: step1.body.ticket, deviceName: "smoke", platform: "test" } });
  return { step1, step2, token: step2.body.token };
};

const wrong = await call("/login", { method: "POST", body: { phone: "07701234567", code: "NOPE" } });
check(wrong.status === 401 && wrong.body.error === "رقم الهاتف أو الرمز غير صحيح", "wrong code → 401 with the generic message");

const active = await login("٠٧٧٠١٢٣٤٥٦٧", "hf1001");
check(active.step1?.status === 200 && active.step1.body.name === "طالب تجريبي", "arabic digits + lowercase code → name for confirmation");
check(active.step2?.status === 200 && typeof active.token === "string", "confirm → device token");

const me = await call("/me", { token: active.token });
check(me.status === 200 && me.body.student?.code === "HF1001" && me.body.student.courseName === "أحياء سادس" && me.body.student.chapterName === "الفصل الأول", "/me returns profile with course and chapter");
const opp = await call("/opportunities", { token: active.token });
check(opp.status === 200 && opp.body.opportunities === 2 && opp.body.logs?.length === 1 && opp.body.activeChapter?.name === "الفصل الأول", "/opportunities returns balance 2 and one ledger row");
const home = await call("/home", { token: active.token });
const examIds = (home.body.upcomingExams || []).map((e) => e.id);
check(home.status === 200 && JSON.stringify(examIds) === JSON.stringify(["seed-exam-open", "seed-exam-next"]), `/home upcoming exams are the open one then tomorrow's (${examIds})`);
check(home.body.upcomingExams?.[0]?.isOpen === true && home.body.upcomingExams?.[1]?.isOpen === false, "/home marks only the current window open");
const displays = (home.body.grades || []).map((g) => g.display);
check(JSON.stringify(displays) === JSON.stringify(["غائب", "42 / 50"]), `/home grades newest first with status text (${displays})`);

const parent = await login("+964 780 987 6543", "HF1003");
check(parent.step1?.status === 200 && parent.step1.body.name === "سارة الأخت", "parent phone + sibling code selects that sibling");
const parentWrong = await login("07809876543", "HF1001");
check(parentWrong.step1?.status === 401, "parent phone with a non-sibling code is refused");

const dismissed = await login("07705555555", "HF1004");
const dHome = await call("/home", { token: dismissed.token });
const dNames = (dHome.body.grades || []).map((g) => g.examName);
check(dHome.status === 200 && dHome.body.gradesUnavailable === false && JSON.stringify(dNames) === JSON.stringify(["الامتحان الأول"]), `dismissed student sees only pre-dismissal grades (${dNames})`);
const dMe = await call("/me", { token: dismissed.token });
check(dMe.body.student?.isDismissed === true && dMe.body.student.contact?.chancesUrl === "https://t.me/hf_chances", "dismissed profile flags isDismissed with the chances link");

const out = await call("/logout", { method: "POST", token: active.token });
const after = await call("/me", { token: active.token });
check(out.status === 200 && after.status === 401 && after.body.code === "SESSION_REVOKED", "logout revokes the token → SESSION_REVOKED");

let limited = null;
for (let i = 0; i < 7; i += 1) {
  const r = await call("/login", { method: "POST", body: { phone: "07700000001", code: "BAD" } });
  if (r.status === 429) { limited = r; break; }
}
check(limited && limited.body.retryAfterSeconds > 0, "repeated wrong attempts → 429 with retryAfterSeconds");

console.log(failed ? "SMOKE FAILED" : "SMOKE OK");
process.exit(failed ? 1 : 0);
