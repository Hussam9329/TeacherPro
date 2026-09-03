// تحقق نهائي قراءة-فقط: المحرك يحسب 2 لكل المعاهدين + فحص الأربعة المطلوبين
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const ts = require("typescript");
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ES2022 } });
  module._compile(output.outputText, filename);
};
const { previewStudentsAcademicState } = require(path.join(root, "src/lib/academic-recalculate-server.ts"));
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
try {
  const logs = await db.opportunityLog.findMany({
    where: { reason: { startsWith: "تسوية تاريخية: تعهد الطالب للامتحان الفاينل الفصل الأول" } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const ids = logs.map((l) => l.studentId);
  const preview = await previewStudentsAcademicState(ids);
  const dist = {};
  preview.students.forEach((s) => { dist[s.opportunities] = (dist[s.opportunities] || 0) + 1; });
  console.log("عدد المعاهدين:", preview.students.length);
  console.log("ما سيحسبه المحرك بأي إعادة احتساب مستقبلية:", JSON.stringify(dist));
  const notTwo = preview.students.filter((s) => s.opportunities !== 2);
  console.log(notTwo.length === 0 ? "✅ لا أحد يعود إلى 3 ولا ينحرف عن فرصتين" : `⚠️ ${notTwo.length} منحرفين`);

  const four = await db.student.findMany({ where: { code: { in: ["BIO-435", "BIO-170", "BIO-489", "BIO-359"] } }, select: { id: true, name: true, opportunities: true, status: true } });
  const byId = new Map(preview.students.map((s) => [s.id, s]));
  console.log("\n=== الأربعة المطلوبون ===");
  four.forEach((s) => console.log(`${s.name} | محفوظ: ${s.opportunities} ${s.status} | حساب المحرك: ${byId.get(s.id)?.opportunities} ${byId.get(s.id)?.status}`));

  const dismissed = preview.students.filter((s) => s.status === "مفصول").length;
  console.log(`\nالمفصولون من المعاهدين (يبقون مفصولين حتى التعهد بزر «تم تعهد الطالب»): ${dismissed}`);
} finally { await db.$disconnect(); }
