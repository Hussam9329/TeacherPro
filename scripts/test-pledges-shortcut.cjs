// «تعهدات» in «الوصول السريع» opens the same «قائمة التعهدات» window. Opened
// from outside it draws no button of its own; inside «إدارة الفرص» and
// «إدارة المفصولين» it keeps its «قائمة التعهدات» button.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const compile = (file, requireFn) => {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("module", "exports", "require", output)(module, module.exports, requireFn);
  return module.exports;
};

const pledgeLimit = compile("src/lib/pledge-limit.ts", () => ({}));
const h = React.createElement;
const passthrough = (tag) => ({ children, className }) => h(tag, { className }, children);
const changes = [];
const { PledgeListDialog } = compile("src/components/teacher-pro/pledge-list-dialog.tsx", (name) => {
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": { Handshake: () => null, Search: () => null },
    "@/components/ui/button": { Button: ({ children }) => h("button", { "data-trigger": "true" }, children) },
    "@/components/ui/dialog": {
      // The window's content shows only while it is open, like the real one.
      Dialog: ({ open, onOpenChange, children }) => (changes.push(onOpenChange), open ? h("div", { "data-dialog": "open" }, children) : null),
      DialogContent: passthrough("section"),
      DialogHeader: passthrough("header"),
      DialogTitle: passthrough("h2"),
      DialogDescription: passthrough("p"),
    },
    "@/components/ui/input": { Input: () => h("input") },
    "@/hooks/use-debounced-value": { useDebouncedValue: (value) => value },
    "@/lib/pledge-list-client": { loadPledgeList: () => new Promise(() => {}) },
    "@/lib/pledge-limit": pledgeLimit,
    "@/lib/teacher-store": { useTeacherStore: (select) => select({ courses: [{ id: "c", name: "الدورة الصيفية" }] }) },
    "zustand/react/shallow": { useShallow: (select) => select },
    "./pledge-chip": { pledgeDateLabel: (iso) => iso },
    "./ui-kit": { EmptyState: () => null, ErrorState: () => null, LoadingState: () => null },
    "./tp-modal.css": {},
    "./pledge-list-dialog.css": {},
  };
  assert(name in mocks, `unexpected dependency: ${name}`);
  return mocks[name];
});
const render = (props) => renderToStaticMarkup(h(PledgeListDialog, { courseName: () => "", ...props }));

// Inside «إدارة الفرص» / «إدارة المفصولين»: its own button, closed.
let html = render({});
assert.match(html, /<button data-trigger="true">قائمة التعهدات<\/button>/);
assert.doesNotMatch(html, /data-dialog/);
console.log("PASS: inside «إدارة الفرص» and «إدارة المفصولين» the window keeps its «قائمة التعهدات» button");

// From «الوصول السريع»: no button; the shortcut decides when it opens.
assert.doesNotMatch(render({ open: false, onOpenChange: () => {} }), /data-trigger|data-dialog/);
const seen = [];
html = render({ open: true, onOpenChange: (open) => seen.push(open) });
assert.doesNotMatch(html, /data-trigger/, "no second button inside the dashboard");
assert.match(html, /data-dialog="open"/);
assert.match(html, /قائمة التعهدات/);
changes.at(-1)(false);
assert.deepEqual(seen, [false], "closing the window tells the shortcut");
console.log("PASS: «تعهدات» in «الوصول السريع» opens the same window without a button of its own");

// The count filter says what is left.
for (const label of ["تعهد واحد · باقيله 1", "تعهدين · باقيله 0", `نفد الحد (${pledgeLimit.PLEDGE_LIMIT_PER_CHAPTER} فأكثر)`]) {
  assert.ok(html.includes(`>${label}</option>`), label);
}
console.log("PASS: the count filter names what is left: «باقيله 1», «باقيله 0», «نفد الحد»");
