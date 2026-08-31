import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads the real TypeScript helper modules without introducing another test
 * runner dependency. Type-only imports are removed by TypeScript, while the
 * database and Next response objects are replaced because these tests exercise
 * pure predicates only and must never connect to production data.
 */
function createTypeScriptModuleLoader() {
  const cache = new Map();
  const mocks = new Map([
    ["@/lib/db", { db: {} }],
    ["next/server", { NextResponse: { json: () => ({}) } }],
  ]);

  function resolveSource(specifier, parentFile) {
    const unresolved = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(parentFile), specifier)
        : null;
    if (!unresolved) return null;

    const candidates = [
      unresolved,
      `${unresolved}.ts`,
      `${unresolved}.tsx`,
      path.join(unresolved, "index.ts"),
      path.join(unresolved, "index.tsx"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  function load(file) {
    const absoluteFile = path.resolve(file);
    if (cache.has(absoluteFile)) return cache.get(absoluteFile).exports;

    const moduleRecord = { exports: {} };
    cache.set(absoluteFile, moduleRecord);
    const source = fs.readFileSync(absoluteFile, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: absoluteFile,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;

    const localRequire = (specifier) => {
      if (mocks.has(specifier)) return mocks.get(specifier);
      const resolved = resolveSource(specifier, absoluteFile);
      return resolved ? load(resolved) : require(specifier);
    };
    const execute = new Function(
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
      compiled,
    );
    execute(
      moduleRecord.exports,
      localRequire,
      moduleRecord,
      absoluteFile,
      path.dirname(absoluteFile),
    );
    return moduleRecord.exports;
  }

  return (relativeFile) => load(path.join(root, relativeFile));
}

const loadTypeScriptModule = createTypeScriptModuleLoader();
const listFilters = loadTypeScriptModule("src/lib/student-list-filters.ts");
const registryFilters = loadTypeScriptModule(
  "src/lib/student-registry-filters-server.ts",
);
const registryIssues = loadTypeScriptModule(
  "src/lib/student-registry-issue-server.ts",
);
const opportunitySnapshots = loadTypeScriptModule(
  "src/lib/student-opportunity-snapshot-server.ts",
);
const registryViewHelpers = loadTypeScriptModule(
  "src/components/teacher-pro/student-registry-helpers.ts",
);
const studentGrace = loadTypeScriptModule("src/lib/student-grace.ts");
const studentExportPagination = loadTypeScriptModule(
  "src/lib/student-export-pagination.ts",
);
const xlsxExport = loadTypeScriptModule("src/lib/xlsx-export.ts");

function text(value, insensitive) {
  const result = String(value ?? "");
  return insensitive ? result.toLocaleLowerCase("ar-IQ") : result;
}

function scalarMatches(value, condition) {
  if (
    condition === null ||
    typeof condition !== "object" ||
    Array.isArray(condition)
  ) {
    return value === condition;
  }

  const insensitive = condition.mode === "insensitive";
  const actual = text(value, insensitive);
  if (Object.hasOwn(condition, "equals")) {
    const expected = condition.equals;
    return expected === null
      ? value === null || value === undefined
      : actual === text(expected, insensitive);
  }
  if (Object.hasOwn(condition, "contains")) {
    return actual.includes(text(condition.contains, insensitive));
  }
  if (Object.hasOwn(condition, "startsWith")) {
    return actual.startsWith(text(condition.startsWith, insensitive));
  }
  if (Object.hasOwn(condition, "in")) {
    return condition.in.some(
      (candidate) => actual === text(candidate, insensitive),
    );
  }
  if (Object.hasOwn(condition, "notIn")) {
    return !condition.notIn.some(
      (candidate) => actual === text(candidate, insensitive),
    );
  }
  if (Object.hasOwn(condition, "not")) {
    return !scalarMatches(value, condition.not);
  }
  if (Object.hasOwn(condition, "gt") && !(Number(value) > condition.gt)) {
    return false;
  }
  if (Object.hasOwn(condition, "gte") && !(Number(value) >= condition.gte)) {
    return false;
  }
  if (Object.hasOwn(condition, "lt") && !(Number(value) < condition.lt)) {
    return false;
  }
  if (Object.hasOwn(condition, "lte") && !(Number(value) <= condition.lte)) {
    return false;
  }
  return true;
}

function relationMatches(value, condition) {
  if (Array.isArray(value)) {
    if (condition.none && value.some((item) => matchesWhere(item, condition.none))) {
      return false;
    }
    if (condition.some && !value.some((item) => matchesWhere(item, condition.some))) {
      return false;
    }
    if (condition.every && !value.every((item) => matchesWhere(item, condition.every))) {
      return false;
    }
    return true;
  }
  return matchesWhere(value || {}, condition);
}

/** Minimal evaluator for the Prisma predicates emitted by registry helpers. */
function matchesWhere(row, where) {
  if (!where || Object.keys(where).length === 0) return true;
  if (where.AND) {
    const parts = Array.isArray(where.AND) ? where.AND : [where.AND];
    if (!parts.every((part) => matchesWhere(row, part))) return false;
  }
  if (where.OR) {
    const parts = Array.isArray(where.OR) ? where.OR : [where.OR];
    if (!parts.some((part) => matchesWhere(row, part))) return false;
  }
  if (where.NOT) {
    const parts = Array.isArray(where.NOT) ? where.NOT : [where.NOT];
    if (parts.some((part) => matchesWhere(row, part))) return false;
  }

  for (const [field, condition] of Object.entries(where)) {
    if (field === "AND" || field === "OR" || field === "NOT") continue;
    const value = row[field];
    const isRelation =
      condition &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      (Object.hasOwn(condition, "none") ||
        Object.hasOwn(condition, "some") ||
        Object.hasOwn(condition, "every") ||
        (value && typeof value === "object"));
    if (
      !(isRelation
        ? relationMatches(value, condition)
        : scalarMatches(value, condition))
    ) {
      return false;
    }
  }
  return true;
}

function matchingIds(rows, where) {
  return rows.filter((row) => matchesWhere(row, where)).map((row) => row.id);
}

const locationRows = [
  {
    id: "baghdad-general",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "عموم بغداد",
  },
  {
    id: "baghdad-mansour",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "المنصور",
  },
  {
    id: "baghdad-banks",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "البنوك",
  },
  {
    id: "nasiriyah-legacy",
    locationScope: "محافظات",
    mainSite: "ذي قار",
    subSite: "ذي قار",
  },
  {
    id: "online-legacy",
    locationScope: "الكتروني",
    mainSite: "الكتروني",
    subSite: "",
  },
  {
    id: "basra",
    locationScope: "محافظات",
    mainSite: "البصرة",
    subSite: "البصرة",
  },
];

test("location aliases and display values are canonical", () => {
  assert.equal(listFilters.normalizeStudentFilterLocation("ذي قار"), "الناصرية");
  assert.equal(listFilters.normalizeStudentFilterLocation("الناصريه"), "الناصرية");
  assert.equal(listFilters.normalizeStudentFilterLocation("الكتروني"), "أونلاين");
  assert.deepEqual(
    listFilters.getStudentFilterLocationAliases("الناصرية"),
    ["الناصرية", "الناصريه", "ذي قار"],
  );
  assert.equal(
    listFilters.getStudentLocationFilterValue(locationRows[1]),
    "المنصور",
  );
  assert.equal(
    listFilters.getStudentLocationFilterValue(locationRows[0]),
    "بغداد",
  );
  assert.equal(
    listFilters.getStudentLocationFilterValue(locationRows[3]),
    "الناصرية",
  );

  const options = listFilters.getStudentLocationFilterOptions(locationRows);
  for (const option of [
    "بغداد",
    "المنصور",
    "البنوك",
    "الناصرية",
    "البصرة",
    "أونلاين",
  ]) {
    assert.ok(options.includes(option), `missing location option: ${option}`);
  }
});

test("client location matching and server predicates select identical rows", () => {
  for (const location of ["بغداد", "المنصور", "الناصرية", "أونلاين"]) {
    const localIds = locationRows
      .filter((row) =>
        listFilters.studentMatchesListFilters(row, { location }),
      )
      .map((row) => row.id);
    const serverWhere = registryFilters.buildStudentRegistryLocationWhere(location);
    assert.deepEqual(matchingIds(locationRows, serverWhere), localIds, location);
  }
  assert.deepEqual(
    matchingIds(
      locationRows,
      registryFilters.buildStudentRegistryLocationWhere("بغداد"),
    ),
    ["baghdad-general", "baghdad-mansour", "baghdad-banks"],
  );
});

const searchableStudents = [
  {
    id: "ali-name",
    name: "Ali Hassan",
    nameKey: "ali hassan",
    school: "Al-Nahrain",
    code: "ST-100",
    telegram: "different_user",
    telegramKey: "different_user",
    phone: "07701234567",
    phoneKey: "07701234567",
    parentPhone: "07801234567",
    status: "نشط",
    gender: "ذكر",
    courseId: "course-ready",
    courseProgram: "كورسات",
    courseTerm: "الكورس الأول",
    studyType: "حضوري",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "المنصور",
  },
  {
    id: "ali-telegram",
    name: "Zaid Kareem",
    nameKey: "zaid kareem",
    school: "Al-Amal",
    code: "ST-200",
    telegram: "ali_teacher",
    telegramKey: "ali_teacher",
    phone: "07709999999",
    phoneKey: "07709999999",
    parentPhone: "07809999999",
    status: "نشط",
    gender: "ذكر",
    courseId: "course-ready",
    courseProgram: "منهج كامل",
    courseTerm: null,
    studyType: "إلكتروني",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "البنوك",
  },
  {
    id: "archived-ali",
    name: "Ali Archived",
    nameKey: "ali archived",
    school: "Al-Amal",
    code: "ST-300",
    telegram: "archived_ali",
    telegramKey: "archived_ali",
    phone: "07708888888",
    phoneKey: "07708888888",
    parentPhone: "07808888888",
    status: "مؤرشف",
    gender: "ذكر",
    courseId: "course-ready",
    courseProgram: "كورسات",
    courseTerm: "الكورس الأول",
    studyType: "حضوري",
    locationScope: "بغداد",
    mainSite: "بغداد",
    subSite: "المنصور",
  },
];

test("latin names remain searchable while Telegram is normalized without @", () => {
  assert.deepEqual(
    matchingIds(
      searchableStudents,
      registryFilters.buildStudentRegistrySearchWhere("Ali"),
    ),
    ["ali-name", "ali-telegram", "archived-ali"],
  );
  assert.deepEqual(
    matchingIds(
      searchableStudents,
      registryFilters.buildStudentRegistrySearchWhere("@ali_teacher"),
    ),
    ["ali-telegram"],
  );
  assert.deepEqual(
    matchingIds(
      searchableStudents,
      registryFilters.buildStudentRegistrySearchWhere("٠٧٧٠١٢٣٤٥٦٧"),
    ),
    ["ali-name"],
  );
});

test("combined registry filters reconcile to the same Prisma predicate", async () => {
  const where = await registryFilters.buildStudentRegistryWhere(
    new URLSearchParams({
      q: "Ali",
      gender: "ذكر",
      courseProgram: "كورسات",
      courseTerm: "الكورس الأول",
      studyType: "حضوري",
      location: "المنصور",
      includeArchived: "1",
    }),
  );
  assert.deepEqual(matchingIds(searchableStudents, where), [
    "ali-name",
    "archived-ali",
  ]);

  const defaultWhere = await registryFilters.buildStudentRegistryWhere(
    new URLSearchParams(),
  );
  assert.deepEqual(matchingIds(searchableStudents, defaultWhere), [
    "ali-name",
    "ali-telegram",
  ]);

  const allStatusesWhere = await registryFilters.buildStudentRegistryWhere(
    new URLSearchParams({ includeArchived: "1" }),
  );
  assert.deepEqual(matchingIds(searchableStudents, allStatusesWhere), [
    "ali-name",
    "ali-telegram",
    "archived-ali",
  ]);

  const archivedWhere = await registryFilters.buildStudentRegistryWhere(
    new URLSearchParams({ status: "مؤرشف", q: "Ali" }),
  );
  assert.deepEqual(matchingIds(searchableStudents, archivedWhere), [
    "archived-ali",
  ]);
});

test("full student export collects and verifies more than 2600 rows", async () => {
  const source = Array.from({ length: 2603 }, (_, index) => ({
    id: `student-${String(index + 1).padStart(5, "0")}`,
    name: `Student ${index + 1}`,
  }));
  const snapshotAt = "2026-08-09T10:00:00.000Z";
  const requestedCursors = [];

  const rows = await studentExportPagination.collectStudentExportPages(
    async ({ cursor, pageSize }) => {
      requestedCursors.push(cursor || "");
      const start = cursor
        ? source.findIndex((row) => row.id === cursor) + 1
        : 0;
      const students = source.slice(start, start + pageSize);
      const nextIndex = start + students.length;
      return {
        students,
        totalCount: source.length,
        hasMore: nextIndex < source.length,
        nextCursor:
          nextIndex < source.length ? students.at(-1)?.id || null : null,
        snapshotAt,
      };
    },
    { pageSize: 500 },
  );

  assert.equal(rows.length, 2603);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2603);
  assert.equal(requestedCursors.length, 6);
  assert.equal(rows.at(-1).id, "student-02603");
});

test("student export refuses incomplete or duplicated page data", async () => {
  await assert.rejects(
    () =>
      studentExportPagination.collectStudentExportPages(async () => ({
        students: [{ id: "one" }],
        totalCount: 2,
        hasMore: false,
        nextCursor: null,
        snapshotAt: "2026-08-09T10:00:00.000Z",
      })),
    /لم يكتمل التصدير/,
  );

  let page = 0;
  await assert.rejects(
    () =>
      studentExportPagination.collectStudentExportPages(async () => {
        page += 1;
        return page === 1
          ? {
              students: [{ id: "duplicate" }],
              totalCount: 2,
              hasMore: true,
              nextCursor: "duplicate",
              snapshotAt: "2026-08-09T10:00:00.000Z",
            }
          : {
              students: [{ id: "duplicate" }],
              totalCount: 2,
              hasMore: false,
              nextCursor: null,
              snapshotAt: "2026-08-09T10:00:00.000Z",
            };
      }),
    /مكرراً/,
  );
});

test("professional Excel export is a genuine styled XLSX workbook", () => {
  const bytes = xlsxExport.buildProfessionalXlsx(
    [{ id: 1, name: "طالب" }],
    [
      { label: "ت", value: (row) => row.id },
      { label: "الاسم", value: (row) => row.name },
    ],
    { title: "سجل الطلاب" },
  );
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  assert.ok(bytes.length > 1000);
});

const activeLinks = [
  {
    courseId: "course-ready",
    chapter: { id: "chapter-ready", name: "Ready", opportunities: 3 },
  },
  {
    courseId: "course-zero",
    chapter: { id: "chapter-zero", name: "Zero", opportunities: 0 },
  },
  {
    courseId: "course-conflict",
    chapter: { id: "chapter-a", name: "A", opportunities: 3 },
  },
  {
    courseId: "course-conflict",
    chapter: { id: "chapter-b", name: "B", opportunities: 4 },
  },
];

const healthRows = [
  {
    id: "missing",
    courseId: "course-missing",
    opportunities: 0,
    baseOpportunities: 0,
    course: { chapters: [] },
  },
  {
    id: "zero-limit",
    courseId: "course-zero",
    opportunities: 0,
    baseOpportunities: 0,
    course: { chapters: [{ active: true, archived: false }] },
  },
  {
    id: "full",
    courseId: "course-ready",
    opportunities: 3,
    baseOpportunities: 3,
    course: { chapters: [{ active: true, archived: false }] },
  },
  {
    id: "over",
    courseId: "course-ready",
    opportunities: 4,
    baseOpportunities: 3,
    course: { chapters: [{ active: true, archived: false }] },
  },
  {
    id: "conflict",
    courseId: "course-conflict",
    opportunities: 2,
    baseOpportunities: 3,
    course: {
      chapters: [
        { active: true, archived: false },
        { active: true, archived: false },
      ],
    },
  },
];

test("chapter health categories are mutually exclusive", () => {
  const cases = [
    ["no-active-chapter", ["missing"]],
    ["zero-opportunity-limit", ["zero-limit"]],
    ["active-chapter-conflict", ["conflict"]],
    ["opportunity-full", ["full"]],
    ["opportunity-over-limit", ["over"]],
  ];
  for (const [issue, expected] of cases) {
    const where = registryIssues.buildStudentRegistryIssueWhereFromLinks(
      issue,
      activeLinks,
    );
    assert.deepEqual(matchingIds(healthRows, where), expected, issue);
  }
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test("opportunity snapshot reconciliation is deterministic and non-mutating", () => {
  const students = deepFreeze(
    healthRows.map(({ id, courseId, opportunities, baseOpportunities }) => ({
      id,
      courseId,
      opportunities,
      baseOpportunities,
    })),
  );
  const links = deepFreeze(activeLinks.map((link) => ({ ...link })));
  const first = opportunitySnapshots.attachStudentOpportunitySnapshotsFromLinks(
    students,
    links,
  );
  const second = opportunitySnapshots.attachStudentOpportunitySnapshotsFromLinks(
    students,
    [...links].reverse(),
  );
  assert.deepEqual(second, first);

  const byId = Object.fromEntries(first.map((row) => [row.id, row]));
  assert.equal(byId.missing.opportunityHealth, "missing-active-chapter");
  assert.equal(byId["zero-limit"].opportunityHealth, "zero-limit");
  assert.equal(byId["zero-limit"].hasActiveChapter, false);
  assert.equal(byId.full.opportunityHealth, "ready");
  assert.equal(byId.full.isOpportunityFull, true);
  assert.equal(byId.full.isOpportunityOverLimit, false);
  assert.equal(byId.over.isOpportunityFull, false);
  assert.equal(byId.over.isOpportunityOverLimit, true);
  assert.equal(byId.conflict.opportunityHealth, "active-chapter-conflict");
  assert.equal(byId.conflict.activeChapterConflictCount, 2);
});

test("mutation reconciliation immediately removes stale filtered rows", () => {
  const original = deepFreeze([
    { id: "keep", name: "Keep" },
    { id: "changed", name: "Old" },
  ]);
  const removed = registryViewHelpers.reconcileRegistryRowsAfterMutation(
    original,
    { id: "changed", name: "Updated" },
    false,
  );
  assert.deepEqual(removed.rows.map((row) => row.id), ["keep"]);
  assert.equal(removed.totalDelta, -1);

  const retained = registryViewHelpers.reconcileRegistryRowsAfterMutation(
    original,
    { id: "changed", name: "Updated" },
    true,
  );
  assert.equal(retained.rows[1].name, "Updated");
  assert.equal(retained.totalDelta, 0);
  assert.equal(original[1].name, "Old");
});

test("grace remaining days decrease by Baghdad calendar day and stop at zero", () => {
  const student = {
    createdAt: "2026-08-01",
    accountingGraceDays: 12,
    gracePeriodStartDate: "2026-08-01",
  };

  assert.equal(
    studentGrace.getStudentGraceDaysRemaining(
      student,
      new Date("2026-08-01T12:00:00.000Z"),
    ),
    12,
  );
  assert.equal(
    studentGrace.getStudentGraceDaysRemaining(
      student,
      new Date("2026-08-07T12:00:00.000Z"),
    ),
    6,
  );
  assert.equal(
    studentGrace.getStudentGraceDaysRemaining(
      student,
      new Date("2026-08-12T12:00:00.000Z"),
    ),
    1,
  );
  assert.equal(
    studentGrace.getStudentGraceDaysRemaining(
      student,
      new Date("2026-08-13T12:00:00.000Z"),
    ),
    0,
  );
  assert.equal(
    studentGrace.isStudentCurrentlyInGrace(
      student,
      new Date("2026-08-13T12:00:00.000Z"),
    ),
    false,
  );
});
