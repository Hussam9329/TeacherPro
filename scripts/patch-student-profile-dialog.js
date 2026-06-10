const fs = require('fs');
const path = 'src/components/teacher-pro/student-registry.tsx';

if (!fs.existsSync(path)) {
  console.log('[student-profile-patch] student registry file not found');
  process.exit(0);
}

let source = fs.readFileSync(path, 'utf8');
let changed = false;

const importFrom = 'import { EmptyState } from "./ui-kit";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";';
const importTo = 'import { EmptyState } from "./ui-kit";\nimport { StudentProfileDialog } from "./student-profile-dialog";\nimport { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";';

if (!source.includes('import { StudentProfileDialog } from "./student-profile-dialog";')) {
  if (!source.includes(importFrom)) throw new Error('[student-profile-patch] import anchor not found');
  source = source.replace(importFrom, importTo);
  changed = true;
}

if (!source.includes('<StudentProfileDialog')) {
  const start = source.indexOf('      <Dialog\n        open={fileDialog.open}\n        onOpenChange={(o) => setFileDialog({ ...fileDialog, open: o })}');
  const endMarker = '\n    </div>\n  );\n}';
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
      />`;

  source = source.slice(0, start) + replacement + source.slice(end);
  changed = true;
}

if (changed) {
  fs.writeFileSync(path, source);
  console.log('[student-profile-patch] professional student profile dialog wired');
} else {
  console.log('[student-profile-patch] already wired');
}
