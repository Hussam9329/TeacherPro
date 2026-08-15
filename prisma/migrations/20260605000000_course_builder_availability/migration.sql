-- AlterTable: Add new fields to Course
ALTER TABLE "Course" ADD COLUMN "availablePrograms" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Course" ADD COLUMN "availableStudyTypes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Course" ADD COLUMN "locationConfig" TEXT NOT NULL DEFAULT '{}';

-- AlterTable: Add new fields to Student
ALTER TABLE "Student" ADD COLUMN "courseProgram" TEXT;
ALTER TABLE "Student" ADD COLUMN "courseTerm" TEXT;
ALTER TABLE "Student" ADD COLUMN "studyType" TEXT;
ALTER TABLE "Student" ADD COLUMN "locationScope" TEXT;
ALTER TABLE "Student" ADD COLUMN "baghdadMode" TEXT;
