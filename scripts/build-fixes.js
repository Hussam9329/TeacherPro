const fs = require('fs');

function updateFile(file, fn) {
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after);
}

updateFile('src/components/teacher-pro/student-registry.tsx', (s) => {
  if (!s.includes('StudentProfileDialog')) {
    s = s.replace(
      'import { EmptyState } from "./ui-kit";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";',
      'import { EmptyState } from "./ui-kit";\nimport { StudentProfileDialog } from "./student-profile-dialog";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";',
    );
  }

  if (!s.includes('<StudentProfileDialog')) {
    const start = s.indexOf('      <Dialog\n        open={fileDialog.open}\n        onOpenChange={(o) => setFileDialog({ ...fileDialog, open: o })}');
    const close = '\n      </Dialog>';
    const componentEnd = s.indexOf('\n    </div>\n  );\n}', start);
    if (start >= 0 && componentEnd >= 0) {
      const block = s.slice(start, componentEnd);
      const lastClose = block.lastIndexOf(close);
      if (lastClose >= 0) {
        const end = start + lastClose + close.length;
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
      />`;
        s = s.slice(0, start) + replacement + s.slice(end);
      }
    }
  }

  if (s.includes('<StudentProfileDialog')) {
    s = s.replace(
      /import \{\n  Dialog,\n  DialogContent,\n  DialogHeader,\n  DialogTitle,\n  DialogFooter,\n  DialogDescription,\n\} from "@\/components\/ui\/dialog";\n/g,
      'import {\n  Dialog,\n  DialogContent,\n  DialogHeader,\n  DialogTitle,\n  DialogFooter,\n} from "@/components/ui/dialog";\n',
    );
    s = s.replace(/import \{ Separator \} from "@\/components\/ui\/separator";\n/g, '');
    s = s.replace(/\nfunction ContactLink\([\s\S]*?\n\}\n\nfunction StudentFileItem\([\s\S]*?\n\}\n\n(?=export function StudentRegistryView\(\))/, '\n');
  }
  return s;
});

updateFile('src/lib/teacher-store.ts', (s) => {
  s = s.replace(/\n        guideMode: state\.guideMode,/g, '');
  s = s.replace(
    /const DATA_KEYS: \(keyof BackupShape\)\[\] = \[\n  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',\n\];/,
    `const DATA_KEYS: (keyof BackupShape)[] = [
  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',
  'opportunityLogs', 'studentLeaves', 'studentCalls', 'studentNotes', 'correctionSheets',
  'users', 'roles', 'logs', 'leaderboardSettings', 'demoCopies',
];`,
  );
  s = s.replace(
    /const DEMO_DATA_KEYS: \(keyof BackupShape\)\[\] = \[\n  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',\n\];/,
    `const DEMO_DATA_KEYS: (keyof BackupShape)[] = [
  'courses', 'sites', 'chapters', 'courseChapters', 'students', 'exams', 'grades',
  'opportunityLogs', 'studentLeaves', 'studentCalls', 'studentNotes', 'correctionSheets',
  'leaderboardSettings',
];`,
  );
  return s;
});
