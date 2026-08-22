#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const failures = [];
const pass = (condition, message) => {
  if (!condition) failures.push(message);
};
const includesAll = (source, values, label) => {
  for (const value of values) {
    pass(source.includes(value), `${label}: missing ${JSON.stringify(value)}`);
  }
};
const walk = (directory) => {
  const absolute = path.join(root, directory);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  });
};

const sourceFiles = [
  ...walk("src/app"),
  ...walk("src/components"),
].filter((file) => /\.(?:css|tsx?|jsx?)$/.test(file));
const teacherProFiles = walk("src/components/teacher-pro").filter((file) => /\.tsx?$/.test(file));
const allSource = sourceFiles.map((file) => read(file)).join("\n");
const teacherProSource = teacherProFiles.map((file) => read(file)).join("\n");

const globals = read("src/app/globals.css");
const button = read("src/components/ui/button.tsx");
const card = read("src/components/ui/card.tsx");
const input = read("src/components/ui/input.tsx");
const dateInput = read("src/components/ui/date-input.tsx");
const checkbox = read("src/components/ui/checkbox.tsx");
const radioGroup = read("src/components/ui/radio-group.tsx");
const select = read("src/components/ui/select.tsx");
const tabs = read("src/components/ui/tabs.tsx");
const dialog = read("src/components/ui/dialog.tsx");
const alertDialog = read("src/components/ui/alert-dialog.tsx");
const layout = read("src/components/teacher-pro/layout.tsx");
const courses = read("src/components/teacher-pro/courses.tsx");
const profileDialog = read("src/components/teacher-pro/student-profile-dialog.tsx");
const gradeEntry = read("src/components/teacher-pro/grade-entry.tsx");
const followUp = read("src/components/teacher-pro/follow-up.tsx");
const smartNotes = read("src/components/teacher-pro/grade-smart-notes-panel.tsx");
const packageJson = JSON.parse(read("package.json"));

// CSS syntax smoke check: comments and quoted strings are ignored before braces are counted.
const cssForBalance = globals
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
let cssDepth = 0;
for (const char of cssForBalance) {
  if (char === "{") cssDepth += 1;
  if (char === "}") cssDepth -= 1;
  pass(cssDepth >= 0, "globals.css: closing brace appears before a matching opening brace");
}
pass(cssDepth === 0, `globals.css: unbalanced braces (${cssDepth})`);

// Never conceal page-level overflow on body or with a broad class-name selector.
for (const match of globals.matchAll(/(?:^|})\s*body\s*\{([^}]*)\}/gms)) {
  pass(!/overflow-x\s*:\s*(?:hidden|clip)/i.test(match[1]), "globals.css: body must not hide or clip horizontal overflow");
}
pass(!/\[class\*=["']overflow-x["']\]/.test(globals), "globals.css: broad overflow-x class selector is prohibited");
pass(!/(?:^|[;{]\s*)(?:width|min-width|max-width|height|min-height|max-height|inline-size|min-inline-size|max-inline-size|inset|left|right|margin|padding|transform|overflow-x)\s*:[^;{}]*!important/im.test(globals), "globals.css: responsive layout dimensions must not be forced with !important");
pass(!/TeacherPro UI\/UX Patch|\bUIUX\s+\d+/i.test(globals), "globals.css: numbered patch layers must be consolidated into named layout contracts");

// Shared mobile-first foundation.
includesAll(globals, [
  "min-inline-size: 0",
  "max-inline-size: 100%",
  ".tp-app-shell",
  ".tp-app-sidebar",
  ".tp-app-header",
  ".tp-app-scroll",
  "[data-teacherpro-active-content=\"true\"] :where(.flex, .grid) > *",
  "[data-teacherpro-active-content=\"true\"] .flex.justify-between",
  "overflow-wrap: anywhere",
  "overscroll-behavior-inline: contain",
  "@media (max-width: 339px)",
  "@media (max-height: 640px)",
  "env(safe-area-inset-top)",
  "env(safe-area-inset-bottom)",
], "globals.css responsive foundation");
pass(/\.table-wrap\s*\{[\s\S]*?overflow-x-auto[\s\S]*?overscroll-behavior-inline:\s*contain/.test(globals), "globals.css: table-wrap must contain horizontal scrolling locally");
includesAll(globals, ["[data-slot=\"select-item\"]", "[data-slot=\"tabs-trigger\"]", "[data-slot=\"checkbox\"]::after", "inset: -0.75rem"], "globals.css touch targets");
pass(/\.table-wrap\s*>\s*table,\s*\n\s*\.responsive-table\s*\{[\s\S]*?min-width:\s*720px/.test(globals), "globals.css: wide tables must use the controlled table container contract");

// Shared controls must be intrinsically shrinkable and allow meaningful content to wrap.
includesAll(button, [
  "max-w-full min-w-0",
  "whitespace-normal",
  "[overflow-wrap:anywhere]",
  "h-auto min-h-10",
  "data-variant=",
  "data-size=",
], "Button");
pass(!button.includes("whitespace-nowrap shrink-0"), "Button: the base variant must not force every button onto one line");
includesAll(card, [
  "w-full max-w-full min-w-0",
  "grid-cols-1",
  "flex-col",
  "[&>[data-slot=button]]:w-full",
], "Card");
includesAll(input, ["h-11", "w-full", "max-w-full", "min-w-0"], "Input");
includesAll(dateInput, ["h-11", "max-w-full", "min-w-0", 'data-slot="date-input-trigger"', "size-11", "touch-target"], "DateInput");
includesAll(checkbox, ["size-5", "touch-manipulation"], "Checkbox touch target");
includesAll(radioGroup, ["size-5", "touch-manipulation"], "Radio touch target");
includesAll(select, [
  "w-full max-w-full min-w-0",
  "whitespace-normal",
  "max-h-[min(var(--radix-select-content-available-height),calc(100dvh-1rem))]",
  "max-w-[calc(100dvw-1rem)]",
  "start-2",
  "data-[size=default]:min-h-11",
  "min-h-11 w-full",
], "Select");
includesAll(tabs, [
  "max-w-full min-w-0",
  "overflow-x-auto",
  "overscroll-x-contain",
  "min-h-11",
], "Tabs");

// Dialogs must remain fully reachable on narrow and short screens.
for (const [name, source] of [["Dialog", dialog], ["AlertDialog", alertDialog]]) {
  includesAll(source, [
    "100dvw",
    "100dvh",
    "min-w-0",
    "overflow-y-auto",
    "overscroll-contain",
    "flex-col-reverse",
  ], name);
}
includesAll(dialog, [
  "[&>[data-slot=dialog-header]]:sticky",
  "[&>[data-slot=dialog-footer]]:sticky",
  "size-10",
], "Dialog reachable regions");

// Main shell: mobile drawer, constrained content, safe header, and explicit RTL.
includesAll(layout, [
  "tp-app-shell",
  "tp-sidebar-overlay",
  "tp-app-sidebar",
  "tp-app-main",
  "tp-app-header",
  "tp-app-scroll",
  "tp-page-surface",
  'dir="rtl"',
  "aria-expanded={sidebarOpen}",
  "h-dvh",
  "100dvw",
], "TeacherPro layout");
pass(/<button[\s\S]*?tp-sidebar-overlay/.test(layout), "TeacherPro layout: mobile drawer overlay must be an accessible button");

// Full-screen and floating interfaces use dynamic viewport units rather than brittle screen classes.
includesAll(courses, ["teacherpro-fullscreen-dialog", "w-dvw", "h-dvh", "max-h-dvh"], "Course full-screen dialog");
includesAll(profileDialog, ["h-dvh", "w-dvw", "safe-area-inset"], "Student profile dialog");
includesAll(gradeEntry, ["100dvw", "safe-area-inset-top", "max-w-sm", "flex-wrap"], "Grade-entry notice");
includesAll(gradeEntry, [
  "lg:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1fr)]",
  "grid-cols-[minmax(0,1fr)_auto]",
  "min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full",
  'data-manual-grade-count-value="true"',
], "Grade-entry manual statistics card");

// No Tailwind force-prefixes for layout sizing; they make cascade repair brittle.
const forcedLayoutUtility = /(?:^|[\s"'`])(?:(?:sm|md|lg|xl|2xl|landscape|portrait):)*!(?:w-|min-w-|max-w-|h-|min-h-|max-h-|p-|px-|py-|m-|mx-|my-|inset-|left-|right-|top-|bottom-|translate-|overflow-)/gm;
pass(!forcedLayoutUtility.test(allSource), "Source: force-prefixed Tailwind layout utility detected");

// Pixel widths in component markup are allowed only for intentionally wide tables inside local scrollers.
const arbitraryPixelWidth = /\b(?:w|min-w|max-w)-\[(\d+)px\]/g;
for (const file of teacherProFiles) {
  const source = read(file);
  for (const match of source.matchAll(arbitraryPixelWidth)) {
    const width = Number(match[1]);
    const line = source.slice(0, match.index).split("\n").length;
    const lineText = source.split("\n")[line - 1] ?? "";
    const allowedTableWidth = [760, 980, 1120].includes(width) && /<table\b/.test(lineText);
    pass(allowedTableWidth, `${file}:${line}: brittle ${match[0]} outside an approved locally scrollable table`);
  }
}
pass(!/\b(?:left|right|top|bottom)-\[\d+px\]/.test(teacherProSource), "TeacherPro pages: hard-coded pixel offsets are prohibited");
pass(!/\b(?:w|h)-screen\b/.test(teacherProSource), "TeacherPro pages: use dynamic viewport units instead of w-screen/h-screen");
pass(!/(?:^|[^a-z])\d+(?:\.\d+)?(?:vh|vw)\b/i.test(teacherProSource), "TeacherPro pages: raw vh/vw units are prohibited; use dynamic viewport units");

// Every live application table must isolate scrolling in a labelled, keyboard-reachable wrapper.
for (const file of teacherProFiles.filter((file) => !file.endsWith("export-dialog.tsx"))) {
  const source = read(file);
  const tableCount = (source.match(/<table\b/g) || []).length;
  if (tableCount === 0) continue;
  const accessibleWrappers = source.match(/<div\b(?=[^>]*className="[^"]*\btable-wrap\b[^"]*")(?=[^>]*tabIndex=\{0\})(?=[^>]*aria-label="[^"]+")[^>]*>\s*<table\b/gms) || [];
  pass(accessibleWrappers.length === tableCount, `${file}: each table needs a labelled tabIndex={0} table-wrap (${accessibleWrappers.length}/${tableCount})`);
}

// Raw interactive controls that bypass the shared Button still need explicit mobile ergonomics.
includesAll(layout, ["group flex min-h-11 w-full touch-manipulation", "tp-sidebar-overlay"], "Sidebar raw controls");
includesAll(layout, [
  "inline-grid size-7 shrink-0 place-items-center",
  "p-0 text-center text-[11px] font-black leading-none",
  "whitespace-nowrap tabular-nums",
], "Sidebar family count alignment");
includesAll(profileDialog, ["min-h-11 max-w-full touch-manipulation", "min-h-11 min-w-0 touch-manipulation"], "Student profile raw controls");
includesAll(followUp, ["flex min-h-11 w-full min-w-0 touch-manipulation"], "Follow-up student picker");
includesAll(smartNotes, ["min-h-11 min-w-0 touch-manipulation"], "Smart-note category controls");

// Responsive safeguards are part of the normal regression suite.
pass(packageJson.scripts?.["test:responsive-ui-integrity"] === "node scripts/test-responsive-ui-integrity.mjs && node scripts/test-responsive-tailwind-compile.mjs", "package.json: test:responsive-ui-integrity script is missing or incorrect");
pass(packageJson.scripts?.["test:side-effects"]?.includes("npm run test:responsive-ui-integrity"), "package.json: responsive integrity test is not wired into test:side-effects");

if (failures.length > 0) {
  console.error(`Responsive UI integrity failed with ${failures.length} issue(s):`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log(`Responsive UI integrity passed (${sourceFiles.length} source files audited).`);
