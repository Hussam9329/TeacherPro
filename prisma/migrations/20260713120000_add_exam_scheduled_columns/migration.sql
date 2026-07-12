-- إضافة أعمدة scheduledActivateAt و scheduledDeactivateAt إلى جدول Exam
-- هذه الأعمدة مذكورة في schema.prisma ويستخدمها migration 20260712143000
-- وكود academic-grade-writeback-server.ts و exam-utils.ts، لكن لا يوجد
-- migration سابق يضيفهما. هذا يسبب خطأ P2021 (column does not exist)
-- عند محاولة حفظ الدرجات.

ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledActivateAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledDeactivateAt" TIMESTAMP(3);
