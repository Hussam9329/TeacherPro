const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/components/teacher-pro/call-notes-management-dialog.tsx'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

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
  const slots = [];
  const reads = [];
  const writes = [];
  const errors = [];
  const intervals = new Map();
  let props = {
    open: true,
    onOpenChange() {},
    courseId: 'course1',
    examId: 'exam1',
    examName: 'امتحان تجريبي',
    canManage: true,
  };
  const depsEqual = (left, right) => left && right &&
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
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
    list(courseId, examId, signal) {
      const request = deferred();
      reads.push({ ...request, courseId, examId, signal });
      return request.promise;
    },
    resolve(note) {
      const request = deferred();
      writes.push({ ...request, note });
      return request.promise;
    },
  };
  const named = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const jsx = (type, elementProps) => ({ type, props: elementProps });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': named(['CheckCheck', 'ClipboardList', 'Loader2', 'RefreshCw']),
    '@/components/ui/button': named(['Button']),
    '@/components/ui/checkbox': named(['Checkbox']),
    '@/components/ui/dialog': named(['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle']),
    '@/lib/call-notes-management-client': { callNotesManagementApi: api },
    '@/lib/teacherpro-sync': { emitTeacherProDataChanged() {} },
    '@/lib/user-toast': { toast: { error: (error) => errors.push(error) } },
  };
  const context = {
    exports: {},
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    AbortController,
    Set,
    Map,
    window: {
      setInterval(callback) { intervals.set(++timer, callback); return timer; },
      clearInterval(id) { intervals.delete(id); },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
  };
  vm.runInNewContext(compiled, context);

  function render() {
    let count = 0;
    do {
      if (++count > 20) throw new Error('Unexpected render loop');
      dirty = false;
      cursor = 0;
      tree = context.exports.CallNotesManagementDialog(props);
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
      render();
    },
    tick() { [...intervals.values()].forEach((callback) => callback()); render(); },
    setProps(next) { props = { ...props, ...next }; render(); },
    nodes(type) { return walk(tree).filter((node) => node.type === type); },
    text() { return JSON.stringify(tree); },
  };
}

const note = (id = 'n1') => ({
  id,
  studentId: `student-${id}`,
  examId: 'exam1',
  notes: `ملاحظة تجريبية ${id}`,
  noteRevision: 1,
  noteResolved: false,
  scope: 'exam',
  student: { id: `student-${id}`, name: `طالب تجريبي ${id}`, code: id },
  contactStatus: 'لم يرد',
});

(async () => {
  let view = harness();
  view.render();
  assert.equal(view.reads.length, 1);
  view.tick();
  view.tick();
  assert.equal(view.reads.length, 1);
  assert.equal(view.reads[0].signal.aborted, false);
  view.reads[0].resolve({ notes: [note()] });
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1);
  console.log('PASS: slow reads survive multiple five-second polling ticks.');

  view.nodes('Checkbox')[0].props.onCheckedChange(true);
  view.render();
  assert.equal(view.nodes('Checkbox').length, 0);
  view.tick();
  assert.equal(view.reads.length, 1);
  view.writes[0].reject(new Error('Network unavailable'));
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 1);
  assert.equal(view.errors.length, 1);
  assert.equal(view.reads.length, 2);
  console.log('PASS: immediate hide, failed-save recovery, and authoritative reload.');

  view.reads[1].resolve({ notes: [note(), note('n2')] });
  await view.flush();
  const boxes = view.nodes('Checkbox');
  boxes[0].props.onCheckedChange(true);
  boxes[1].props.onCheckedChange(true);
  view.render();
  assert.equal(view.nodes('Checkbox').length, 0);
  view.writes[1].resolve({});
  await view.flush();
  assert.equal(view.reads.length, 2);
  view.writes[2].resolve({});
  await view.flush();
  assert.equal(view.reads.length, 3);
  view.reads[2].resolve({ notes: [] });
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0);
  console.log('PASS: concurrent completions reconcile after all writes settle.');

  view = harness();
  view.render();
  view.setProps({ examId: 'exam2' });
  assert.equal(view.reads.length, 2);
  assert.equal(view.reads[0].signal.aborted, true);
  view.reads[0].resolve({ notes: [note('old')] });
  await view.flush();
  assert.equal(view.nodes('Checkbox').length, 0);
  view.reads[1].resolve({ notes: [note('new')] });
  await view.flush();
  assert(view.text().includes('طالب تجريبي new'));
  assert(!view.text().includes('طالب تجريبي old'));
  console.log('PASS: late responses from the previous exam cannot replace the current list.');

  view = harness();
  view.setProps({ canManage: false });
  view.reads[0].resolve({ notes: [note()] });
  await view.flush();
  const readOnlyBox = view.nodes('Checkbox')[0];
  assert.equal(readOnlyBox.props.disabled, true);
  readOnlyBox.props.onCheckedChange(true);
  await view.flush();
  assert.equal(view.writes.length, 0);
  console.log('PASS: users with view-only access cannot complete notes.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
