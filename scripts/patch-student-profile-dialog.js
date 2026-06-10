const fs = require('fs');

function patchFile(path, transform) {
  if (!fs.existsSync(path)) {
    console.log(`[patch] ${path} not found`);
    return;
  }
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[patch] updated ${path}`);
  } else {
    console.log(`[patch] no changes for ${path}`);
  }
}

patchFile('src/components/teacher-pro/student-registry.tsx', (input) => {
  let source = input;

  const importFrom = 'import { EmptyState } from "./ui-kit";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";';
  const importTo = 'import { EmptyState } from "./ui-kit";\nimport { StudentProfileDialog } from "./student-profile-dialog";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";';

  if (!source.includes('import { StudentProfileDialog } from "./student-profile-dialog";')) {
    if (!source.includes(importFrom)) throw new Error('[student-profile-patch] import anchor not found');
    source = source.replace(importFrom, importTo);
  }

  if (!source.includes('<StudentProfileDialog')) {
    const start = source.indexOf('      <Dialog\n        open={fileDialog.open}\n        onOpenChange={(o) => setFileDialog({ ...fileDialog, open: o })}');
    const endMarker = '\n      <AlertDialog\n        open={deleteDialog.open}';
    const end = source.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
      throw new Error('[student-profile-patch] old student file dialog block not found');
    }

    const replacement = `      <StudentProfileDialog
        student={fileDialog.student}
        open={fileDialog.open}
        onOpenChange={(open) => setFileDialog((prev) => ({ ...prev, open }))}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
`;

    source = source.slice(0, start) + replacement + source.slice(end);
  }

  if (source.includes('<StudentProfileDialog')) {
    source = source.replace(/import \{ Separator \} from "@\/components\/ui\/separator";\n/g, '');
    source = source.replace(
      /import \{\n  Dialog,\n  DialogContent,\n  DialogHeader,\n  DialogTitle,\n  DialogFooter,\n  DialogDescription,\n\} from "@\/components\/ui\/dialog";\n/g,
      `import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
`
    );
  }

  return source;
});

patchFile('src/lib/teacher-store.ts', (input) => {
  let source = input;

  source = source.replace(/\n        guideMode: state\.guideMode,/g, '');

  source = source.replace(
    /const DATA_KEYS: \(keyof BackupShape\)\[\] = \[\n  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',\n\];/,
    `const DATA_KEYS: (keyof BackupShape)[] = [
  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',
  'opportunityLogs', 'studentLeaves', 'studentCalls', 'studentNotes', 'correctionSheets',
  'users', 'roles', 'logs', 'leaderboardSettings', 'demoCopies',
];`
  );

  source = source.replace(
    /const DEMO_DATA_KEYS: \(keyof BackupShape\)\[\] = \[\n  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',\n\];/,
    `const DEMO_DATA_KEYS: (keyof BackupShape)[] = [
  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',
  'opportunityLogs', 'studentLeaves', 'studentCalls', 'studentNotes', 'correctionSheets',
  'leaderboardSettings',
];`
  );

  return source;
});
