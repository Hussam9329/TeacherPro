// معاينة قراءة-فقط: نتيجة المحرك المُصلح قبل وبعد إعادة صياغة أسباب التعهد
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const ts = require("typescript");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

const { previewStudentsAcademicState } = require(
  path.join(root, "src/lib/academic-recalculate-server.ts"),
);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const TARGET_CODES = ["BIO-435", "BIO-170", "BIO-489", "BIO-359"];

try {
  const students = await db.student.findMany({
    where: { code: { in: TARGET_CODES } },
    select: { id: true, name: true, code: true, opportunities: true, status: true },
  });
  const ids = students.map((s) => s.id);

  const preview = await previewStudentsAcademicState(ids);
  const byId = new Map(preview.students.map((s) => [s.id, s]));

  console.log("=== معاينة المحرك المُصلح (الوضع الحالي للأسباب) ===");
  for (const s of students) {
    const next = byId.get(s.id);
    console.log(
      `${s.name} (${s.code}) | حالياً: ${s.opportunities} ${s.status} | بعد المحرك المصلح: ${next?.opportunities} ${next?.status}`,
    );
  }
} catch (error) {
  console.error("PREVIEW FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
