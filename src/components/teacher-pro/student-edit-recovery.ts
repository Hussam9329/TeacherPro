import type { StudentEditForm } from "./student-registry-helpers";

export type StudentEditField = keyof StudentEditForm;
export type StudentEditRecoveryChoice = "draft" | "latest";

export const studentEditFieldLabels: Record<StudentEditField, string> = {
  name: "اسم الطالب",
  school: "المدرسة",
  gender: "الجنس",
  phone: "رقم الطالب",
  parentPhone: "رقم ولي الأمر",
  telegram: "تيليجرام",
  username: "يوزر التيليجرام (المستعاد)",
  courseProgram: "نوع الدورة",
  courseTerm: "الكورس",
  studyType: "أسلوب الدراسة",
  locationScope: "نطاق الموقع",
  baghdadMode: "نظام بغداد",
  courseId: "الدورة",
  subSite: "الموقع",
  createdAt: "تاريخ التسجيل",
  accountingGraceDays: "مدة السماح",
};

// A course/site change can invalidate other enrollment fields even if two
// people edited different fields. Require review of the combined context.
const enrollmentFields: StudentEditField[] = [
  "courseId", "courseProgram", "courseTerm", "studyType",
  "locationScope", "baghdadMode", "subSite",
];

function comparable(field: StudentEditField, value: unknown): string {
  return field === "accountingGraceDays"
    ? String(Number(value || 0))
    : String(value ?? "").trim();
}

export function prepareStudentEditRecovery(
  original: StudentEditForm,
  draft: StudentEditForm,
  latest: StudentEditForm,
) {
  const changed = (a: StudentEditForm, b: StudentEditForm, field: StudentEditField) =>
    comparable(field, a[field]) !== comparable(field, b[field]);
  const enrollmentConflict =
    enrollmentFields.some((field) => changed(original, draft, field)) &&
    enrollmentFields.some((field) => changed(original, latest, field));
  const fields = Object.keys(studentEditFieldLabels) as StudentEditField[];
  const form = { ...latest };
  const conflicts: Array<{
    field: StudentEditField;
    draft: string;
    latest: string;
  }> = [];
  for (const field of fields) {
    const localChanged = changed(original, draft, field);
    const serverChanged = changed(original, latest, field);
    const differs = changed(draft, latest, field);
    if (differs && ((localChanged && serverChanged) ||
      (enrollmentConflict && enrollmentFields.includes(field)))) {
      conflicts.push({ field, draft: String(draft[field] ?? ""), latest: String(latest[field] ?? "") });
    }
    if (localChanged) Object.assign(form, { [field]: draft[field] });
  }
  return {
    form,
    conflicts,
    matchesDraft: fields.every((field) => !changed(draft, latest, field)),
    refreshedFields: fields.filter((field) => changed(original, latest, field)),
  };
}

export type StudentEditRecovery = ReturnType<typeof prepareStudentEditRecovery>;

export function resolveStudentEditRecovery(
  recovery: StudentEditRecovery,
  choices: Partial<Record<StudentEditField, StudentEditRecoveryChoice>>,
): StudentEditForm | null {
  const form = { ...recovery.form };
  for (const conflict of recovery.conflicts) {
    const choice = choices[conflict.field];
    if (choice !== "draft" && choice !== "latest") return null;
    Object.assign(form, { [conflict.field]: conflict[choice] });
  }
  return form;
}
