const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/components/teacher-pro/code-closures-dialog.tsx'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const validationContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(root, 'src/lib/validation.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, validationContext);

// Use the real presentation helper, including its native Telegram link policy.
const helperModules = new Map();
function loadHelper(specifier, parentFile = path.join(root, 'src/index.ts')) {
  const file = `${specifier.startsWith('@/')
    ? path.join(root, 'src', specifier.slice(2))
    : path.resolve(path.dirname(parentFile), specifier)}.ts`;
  if (helperModules.has(file)) return helperModules.get(file).exports;
  const module = { exports: {} };
  helperModules.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('module', 'exports', 'require', output)(
    module, module.exports, (name) => loadHelper(name, file),
  );
  return module.exports;
}
const registryHelpers = loadHelper('@/components/teacher-pro/student-registry-helpers');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

// Execute the actual component with deterministic hooks and deferred requests.
// This exercises its async state transitions, not browser layout or Radix itself.
function harness() {
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let tree;
  let timer = 0;
  let mounted = true;
  const slots = [];
  const reads = [];
  const writes = [];
  const errors = [];
  const intervals = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let props = {
    open: true,
    onOpenChange() {},
    canManage: true,
  };
  const depsEqual = (left, right) => left && right &&
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useId() { return 'closure-filter-test'; },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      }
      return [slots[index].value, (next) => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) {
          slots[index].value = value;
          dirty = true;
        }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
        slots[index] = { value: callback, deps };
      }
      return slots[index].value;
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
        slots[index] = { value: factory(), deps };
      }
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || !depsEqual(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const api = {
    list(signal) {
      const request = deferred();
      reads.push({ ...request, signal });
      return request.promise;
    },
    save(...args) {
      const request = deferred();
      writes.push({ ...request, args });
      return request.promise;
    },
  };
  const named = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const jsx = (type, elementProps) => ({ type, props: elementProps });
  const dependencies = {
    react,
    './code-closures-dialog.css': {},
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': named(['AlertCircle', 'BookOpen', 'CalendarDays', 'CheckCheck', 'ChevronDown', 'LockKeyhole', 'Loader2', 'MessageCircle', 'RefreshCw', 'Search', 'UserRound', 'X']),
    '@/components/ui/button': named(['Button']),
    '@/components/ui/checkbox': named(['Checkbox']),
    '@/components/ui/dialog': named(['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle']),
    '@/components/ui/input': named(['Input']),
    '@/lib/code-closures-client': { codeClosuresApi: api },
    '@/lib/dismissed-check-api': { saveDismissedCheck: (...args) => api.save(...args) },
    '@/lib/teacherpro-sync': { emitTeacherProDataChanged() {} },
    '@/lib/user-toast': { toast: { error: (error) => errors.push(error) } },
    '@/lib/validation': validationContext.exports,
    './student-registry-helpers': registryHelpers,
    '@/lib/baghdad-time': loadHelper('@/lib/baghdad-time'),
    '@/lib/format': loadHelper('@/lib/format'),
  };
  const context = {
    exports: {},
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    AbortController,
    Error,
    Set,
    Map,
    window: {
      setInterval(callback) { intervals.set(++timer, callback); return timer; },
      clearInterval(id) { intervals.delete(id); },
      addEventListener(name, callback) { windowListeners.set(name, callback); },
      removeEventListener(name) { windowListeners.delete(name); },
    },
    document: {
      visibilityState: 'visible',
      addEventListener(name, callback) { documentListeners.set(name, callback); },
      removeEventListener(name) { documentListeners.delete(name); },
    },
  };
  vm.runInNewContext(compiled, context);

  function render() {
    let count = 0;
    do {
      if (++count > 20) throw new Error('Unexpected render loop');
      dirty = false;
      cursor = 0;
      tree = context.exports.CodeClosuresDialog(props);
      const pendingEffects = effects;
      effects = [];
      pendingEffects.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }

  function walk(node, result = []) {
    if (!node) return result;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, result));
    } else if (typeof node === 'object') {
      result.push(node);
      walk(node.props?.children, result);
    }
    return result;
  }

  return {
    reads, writes, errors, render,
    async flush() {
      // Drain promises originating in the VM realm before applying state updates.
      await new Promise((resolve) => setImmediate(resolve));
      if (mounted) render();
    },
    tick() { [...intervals.values()].forEach((callback) => callback()); render(); },
    focus() { windowListeners.get('focus')?.(); render(); },
    setVisibility(value) {
      context.document.visibilityState = value;
      documentListeners.get('visibilitychange')?.();
      render();
    },
    unmount() { mounted = false; slots.forEach((slot) => slot?.cleanup?.()); },
    setProps(next) { props = { ...props, ...next }; render(); },
    nodes(type) { return walk(tree).filter((node) => node.type === type); },
    text() { return JSON.stringify(tree); },
  };
}

const student = (id, checked = false, courseId = 'course1') => ({
  id,
  name: id === 'first' ? 'أحمد علي' : `طالب ${id}`,
  code: `BIO-${id}`,
  status: 'مفصول',
  dismissedChecked: checked,
  dismissedCheckEpoch: 3,
  courseId,
  course: { id: courseId, name: courseId === 'course1' ? 'الصيفية' : 'الشتوية' },
  dismissalReason: 'غياب في الامتحان',
});
const response = (students) => ({
  students,
  totalCount: students.length,
  checkedCount: students.filter((value) => value.dismissedChecked).length,
  uncheckedCount: students.filter((value) => !value.dismissedChecked).length,
  generatedAt: '2026-09-21T15:00:00.000Z',
});
const snapshot = (value, checked) => ({
  id: value.id, status: value.status, dismissedChecked: checked, dismissedCheckEpoch: value.dismissedCheckEpoch,
});
function filter(view, label) {
  const button = view.nodes('Button').find((node) => node.props['aria-label'] === label);
  assert(button, `Missing ${label} status filter`);
  button.props.onClick();
  view.render();
}
function checkedValues(view) {
  return view.nodes('Checkbox').map((node) => node.props.checked);
}
function setSearch(view, value) {
  view.nodes('Input')[0].props.onChange({ target: { value } });
  view.render();
}
function selectCourse(view, value) {
  view.nodes('select')[0].props.onChange({ target: { value } });
  view.render();
}

(async () => {
  const first = { ...student('first'), username: '@Student_First', telegram: '123456789', lastDismissalAt: '2026-09-25T22:30:00.000Z' };
  const saved = { ...student('saved', true), username: null, telegram: '987654321', lastDismissalAt: null };
  const second = { ...student('second', false, 'course2'), username: null, telegram: 'legacy_student', lastDismissalAt: null };
  let view = harness();
  view.render();
  assert.equal(view.reads.length, 1);
  view.tick();
  view.tick();
  assert.equal(view.reads.length, 1, 'Polling must allow slow reads to finish');
  assert.equal(view.reads[0].signal.aborted, false);
  view.reads[0].resolve(response([first, saved, second]));
  await view.flush();
  assert.deepEqual(checkedValues(view), [false, false]);
  assert(!view.text().includes('طالب saved'));
  assert(view.text().includes('المعروض 2 من 3 طالب مفصول'));
  assert.deepEqual(view.nodes('a').map((node) => node.props.href), [
    'tg://resolve?domain=student_first',
    'tg://resolve?domain=legacy_student',
  ], 'prefer the saved username over numeric Telegram ID, with a legacy username fallback');
  assert(view.nodes('a').every((node) => !node.props.target && !node.props.onClick), 'native links do not redirect through a web page or trigger a closure action');
  assert.equal(view.nodes('time')[0].props.children, '2026/9/26', 'dismissal dates use the Baghdad calendar day');
  assert(view.text().includes('غير مسجل'), 'missing dates are explicit rather than invented');
  assert(!view.text().includes(first.dismissalReason), 'dismissal reasons start hidden');
  const reasonButton = () => view.nodes('Button').find((node) => node.props['aria-label']?.endsWith(`سبب فصل ${first.name}`));
  reasonButton().props.onClick();
  view.render();
  assert.equal(reasonButton().props['aria-expanded'], true);
  assert.equal(view.nodes('p').filter((node) => node.props.className === 'tp-closures__reason').length, 1, 'only the clicked student reveals their reason');
  assert.equal(view.writes.length, 0, 'revealing a reason never changes the shared checked flag');
  reasonButton().props.onClick();
  view.render();
  assert.equal(reasonButton().props['aria-expanded'], false);
  assert(!view.text().includes(first.dismissalReason));
  filter(view, 'Checked');
  assert.deepEqual(checkedValues(view), [true]);
  assert(view.text().includes('طالب saved'));
  assert.equal(view.nodes('a').length, 0, 'numeric Telegram IDs are displayed without broken chat links');
  assert(view.text().includes('987654321'));
  filter(view, 'All');
  assert.deepEqual(checkedValues(view), [false, true, false]);
  assert.equal(view.writes.length, 0, 'Opening and filtering must never change saved flags');
  console.log('PASS: all saved checked flags remain intact; initial unChecked, Checked and All show exact memberships.');

  selectCourse(view, 'course2');
  assert.equal(view.nodes('Checkbox').length, 1);
  assert(view.text().includes('المعروض 1 من 1 طالب مفصول'));
  const courseCount = (label) => view.nodes('Button').find((node) => node.props['aria-label'] === label).props.children[1].props.children;
  assert.equal(courseCount('All'), 1);
  assert.equal(courseCount('Checked'), 0);
  assert.equal(courseCount('unChecked'), 1);
  selectCourse(view, 'course1');
  setSearch(view, 'احمد');
  assert.equal(view.nodes('Checkbox').length, 1);
  assert(view.text().includes('أحمد علي'));
  setSearch(view, 'BIO-saved');
  assert.deepEqual(checkedValues(view), [true]);
  const clear = view.nodes('Button').find((node) => JSON.stringify(node.props.children).includes('مسح الفلاتر'));
  clear.props.onClick();
  view.render();
  assert.deepEqual(checkedValues(view), [false, false]);
  assert.equal(view.nodes('Input')[0].props.value, '');
  assert.equal(view.nodes('select')[0].props.value, '');
  console.log('PASS: Arabic name/code search and course filter narrow the full set; clearing restores pending codes.');

  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  assert.equal(view.nodes('Checkbox').length, 1, 'Checking hides the row immediately from unChecked');
  assert.deepEqual(view.writes[0].args, [first.id, true, false, 3]);
  filter(view, 'All');
  assert.deepEqual(checkedValues(view), [true, true, false]);
  assert.equal(view.nodes('Checkbox')[0].props.disabled, true);
  view.tick();
  assert.equal(view.reads.length, 1);
  view.writes[0].resolve(snapshot(first, true));
  await view.flush();
  assert.equal(view.reads.length, 2);
  view.reads[1].resolve(response([{ ...first, dismissedChecked: true }, saved, second]));
  await view.flush();
  filter(view, 'Checked');
  view.nodes('Checkbox')[0].props.onCheckedChange(false);
  view.render();
  assert.equal(view.nodes('Checkbox').length, 1, 'Unchecking hides the row from Checked');
  assert.deepEqual(view.writes[1].args, [first.id, false, true, 3]);
  view.writes[1].resolve(snapshot(first, false));
  await view.flush();
  view.reads[2].resolve(response([first, saved, second]));
  await view.flush();
  assert.deepEqual(checkedValues(view), [true]);
  console.log('PASS: check/uncheck save explicit expected values and dismissal epoch; optimistic filtering preserves other students.');

  filter(view, 'unChecked');
  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  view.writes[2].reject(new Error('Network unavailable'));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0, 'Uncertain writes must wait for authoritative reconciliation');
  assert.equal(view.errors.length, 1);
  assert.equal(view.reads.length, 4);
  assert(!view.text().includes('المعروض 0 من 0'));
  view.reads[3].resolve(response([{ ...first, dismissedChecked: true }, saved, second]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1, 'Committed but disconnected write is reflected by the next read');
  assert.equal(view.writes.length, 3, 'An uncertain write must not be retried');
  console.log('PASS: uncertain-save failures clear untrusted rows, preserve database outcome, and never replay a write.');

  view.tick();
  view.reads[4].reject(new Error('Read failed'));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0);
  assert(view.text().includes('Read failed'));
  assert(!view.text().includes('المعروض 0 من 0'));
  view.tick();
  view.reads[5].resolve(response([second]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1);
  assert(!view.text().includes('Read failed'));
  console.log('PASS: failed refresh never presents stale students/counts as current and recovers automatically.');

  view = harness();
  view.render();
  view.reads[0].resolve(response([first, saved, second]));
  await view.flush();
  const boxes = view.nodes('Checkbox');
  boxes[0].props.onCheckedChange(true);
  boxes[1].props.onCheckedChange(true);
  view.render();
  assert.equal(view.nodes('Checkbox').length, 0);
  view.writes[0].resolve(snapshot(first, true));
  await view.flush();
  assert.equal(view.reads.length, 1);
  view.writes[1].resolve(snapshot(second, true));
  await view.flush();
  assert.equal(view.reads.length, 2);
  view.reads[1].resolve(response([{ ...first, dismissedChecked: true }, saved, { ...second, dismissedChecked: true }]));
  await view.flush();
  filter(view, 'All');
  assert.deepEqual(checkedValues(view), [true, true, true]);
  console.log('PASS: concurrent writes reconcile once after completion and do not overwrite existing checked flags.');

  filter(view, 'unChecked');
  selectCourse(view, 'course2');
  view.tick();
  const newcomer = student('new', false, 'course2');
  view.reads[2].resolve(response([saved, { ...second, dismissedChecked: true }, newcomer]));
  await view.flush();
  assert.equal(view.nodes('select')[0].props.value, 'course2');
  assert.equal(view.nodes('Checkbox').length, 1);
  assert(view.text().includes('طالب new'));
  assert(!view.text().includes('أحمد علي'));
  filter(view, 'All');
  selectCourse(view, '');
  assert.equal(view.nodes('Checkbox').length, 3);
  assert(view.text().includes('المعروض 3 من 3 طالب مفصول'));
  console.log('PASS: polling removes activated students, receives new dismissals/other users’ checks, and preserves active filters.');

  view = harness();
  view.render();
  view.setProps({ open: false });
  view.setProps({ open: true });
  assert.equal(view.reads.length, 2);
  assert.equal(view.reads[0].signal.aborted, true);
  view.reads[0].resolve(response([student('old')]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0);
  view.reads[1].resolve(response([first, saved]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1);
  assert(!view.text().includes('طالب old'));
  console.log('PASS: old-opening read responses cannot replace a current list.');

  view.tick();
  const staleRead = view.reads[2];
  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  assert.equal(staleRead.signal.aborted, true);
  staleRead.resolve(response([first, saved]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0);
  filter(view, 'All');
  setSearch(view, 'احمد');
  view.setProps({ open: false });
  view.setProps({ open: true });
  assert.equal(view.reads.length, 3, 'Reopening waits for a pending write before reading');
  assert.equal(view.nodes('Input')[0].props.value, '');
  assert.equal(view.nodes('Checkbox').length, 0);
  view.writes[0].resolve(snapshot(first, true));
  await view.flush();
  assert.equal(view.reads.length, 4, 'Pending write settles into a refresh for the new opening');
  view.reads[3].resolve(response([{ ...first, dismissedChecked: true }, saved, second]));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1, 'Reopening always returns to unChecked');
  assert(view.text().includes('طالب second'));
  assert(!view.text().includes('أحمد علي'));
  console.log('PASS: stale reads cannot undo optimistic changes; close/reopen during a write preserves pending state and resets filters safely.');

  view.setProps({ canManage: false });
  assert.equal(view.nodes('Checkbox')[0].props.disabled, true);
  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  assert.equal(view.writes.length, 1);
  console.log('PASS: read-only users cannot issue closure mutations.');

  view = harness();
  view.render();
  view.reads[0].resolve(response([first]));
  await view.flush();
  view.setVisibility('hidden');
  view.tick();
  view.focus();
  assert.equal(view.reads.length, 1);
  view.setVisibility('visible');
  assert.equal(view.reads.length, 2);
  view.reads[1].resolve(response([first]));
  await view.flush();
  view.focus();
  assert.equal(view.reads.length, 3);
  view.reads[2].resolve(response([first]));
  await view.flush();
  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  view.unmount();
  view.writes[0].resolve(snapshot(first, true));
  await view.flush();
  assert.equal(view.reads.length, 3, 'Settling a write after unmount must not start a new read');
  console.log('PASS: hidden windows pause polling, focus restores freshness, and unmount prevents follow-up requests.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
