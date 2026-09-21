const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const hook = compile("src/hooks/use-dismissed-checks.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function harness(initialStudents) {
  const slots = [];
  const reads = [];
  const writes = [];
  const errors = [];
  const intervals = new Map();
  let props = { students: initialStudents, userId: "operator", canEdit: true, unavailable: false };
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let current;
  let timer = 0;
  let statusRefreshes = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps, cleanup };
        effects.push(() => { cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const dependencies = {
    react,
    "@/lib/dismissed-check-api": {
      readDismissedChecks(ids, signal) { const request = deferred(); reads.push({ ...request, ids, signal }); return request.promise; },
      saveDismissedCheck(id, checked, expectedChecked, expectedEpoch) {
        const request = deferred();
        writes.push({ ...request, id, checked, expectedChecked, expectedEpoch });
        return request.promise;
      },
    },
    "@/lib/teacherpro-sync": { emitTeacherProDataChanged() {}, subscribeTeacherProDataChanged() { return () => {}; } },
    "@/lib/user-toast": { toast: { error(message) { errors.push(message); } } },
  };
  const context = {
    exports: {},
    require(name) { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name]; },
    AbortController, Set, Map,
    window: {
      setInterval(callback) { intervals.set(++timer, callback); return timer; },
      clearInterval(id) { intervals.delete(id); },
      addEventListener() {}, removeEventListener() {},
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  };
  vm.runInNewContext(hook, context);
  function render() {
    let count = 0;
    do {
      assert(++count < 20, "render settles");
      dirty = false;
      cursor = 0;
      current = context.exports.useDismissedChecks(props.students, props.userId, props.canEdit, props.unavailable, () => { statusRefreshes += 1; });
      const queue = effects;
      effects = [];
      queue.forEach((effect) => effect());
    } while (dirty);
  }
  render();
  return {
    reads, writes, errors,
    get state() { return current; },
    get statusRefreshes() { return statusRefreshes; },
    update(next) { props = { ...props, ...next }; render(); },
    toggle(student, checked) { const saved = current.toggle(student, checked); render(); return saved; },
    tick() { [...intervals.values()].forEach((callback) => callback()); render(); },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); render(); },
  };
}

const student = (checked = false, epoch = 0, status = "مفصول", id = "s1") => ({
  id, name: "طالب تجريبي", status, dismissedChecked: checked, dismissedCheckEpoch: epoch,
});

(async () => {
  const old = student(true);
  let view = harness([old]);
  view.reads[0].resolve([old]);
  await view.flush();
  assert.equal(view.state.snapshots.s1.dismissedChecked, true);
  view.update({ students: [student(false, 1, "نشط")] });
  assert.equal(view.state.snapshots.s1, undefined, "reactivation removes the former flag from the client cache");
  const again = student(false, 2);
  view.update({ students: [again] });
  assert.equal(view.state.snapshots.s1, undefined, "a new dismissal cannot reuse the old checked snapshot");
  view.reads.at(-1).resolve([again]);
  await view.flush();
  assert.equal(view.state.snapshots.s1.dismissedChecked, false);
  console.log("PASS: reactivation clears snapshots and a later dismissal starts unchecked.");

  for (const fail of [false, true]) {
    view = harness([student()]);
    view.reads[0].resolve([student()]);
    await view.flush();
    const oldSave = view.toggle(student(), true);
    assert.equal(view.state.snapshots.s1.dismissedChecked, true, "optimistic check is visible");
    assert.equal(view.writes[0].expectedEpoch, 0, "save carries its dismissal epoch");
    view.update({ students: [student(false, 1, "نشط")] });
    view.update({ students: [again] });
    view.reads.at(-1).resolve([again]);
    await view.flush();
    const newSave = view.toggle(again, true);
    assert.equal(view.writes[1].expectedEpoch, 2);
    if (fail) view.writes[0].reject(new Error("obsolete write"));
    else view.writes[0].resolve(student(true));
    await oldSave;
    await view.flush();
    assert.equal(view.state.snapshots.s1.dismissedCheckEpoch, 2, "old response cannot resurrect a former dismissal");
    assert.equal(view.state.pendingIds.has("s1"), true, "old cleanup cannot unlock a new dismissal's pending save");
    assert.equal(view.errors.length, 0, "obsolete failures cannot display a misleading error");
    view.writes[1].resolve(student(true, 2));
    await newSave;
    await view.flush();
    assert.equal(view.state.snapshots.s1.dismissedCheckEpoch, 2);
  }
  console.log("PASS: stale successes, stale failures, and stale cleanup cannot overwrite a later dismissal or its pending action.");

  view = harness([old]);
  const previousRead = view.reads[0];
  view.update({ students: [student(false, 0, "مفصول", "other")] });
  previousRead.resolve([old]);
  await view.flush();
  assert.equal(view.state.snapshots.s1, undefined, "late read cannot refill a page that was left");
  view.update({ students: [again] });
  assert.equal(view.state.snapshots.s1, undefined);
  view.reads.at(-1).resolve([again]);
  await view.flush();
  assert.equal(view.state.snapshots.s1.dismissedChecked, false);
  console.log("PASS: page changes purge cached values and ignore late reads.");

  view = harness([old]);
  view.reads[0].resolve([old]);
  await view.flush();
  view.update({ students: [again] });
  assert.equal(view.state.snapshots.s1, undefined, "epoch change clears stale flags even if active state was never rendered");
  view.reads.at(-1).resolve([again]);
  await view.flush();
  assert.equal(view.state.snapshots.s1.dismissedChecked, false);
  view.tick();
  view.reads.at(-1).resolve([student(false, 3, "نشط")]);
  await view.flush();
  assert.equal(view.state.snapshots.s1.status, "نشط", "authoritative poll hides a checkbox before the registry refresh arrives");
  assert.equal(view.statusRefreshes, 1);
  console.log("PASS: a new dismissal epoch invalidates old snapshots and server status changes request a registry refresh.");

  const requests = [];
  const apiContext = {
    exports: {},
    require(name) {
      if (name === "@/lib/outbox-session") return { ownerHeaders: () => ({}) };
      if (name === "@/lib/read-deadline") return { withReadDeadline: (callback) => callback() };
      throw new Error(`Unexpected import ${name}`);
    },
    async fetch(url, options) { requests.push({ url, ...options }); return { ok: true, json: async () => ({ student: again }) }; },
  };
  vm.runInNewContext(compile("src/lib/dismissed-check-api.ts"), apiContext);
  await apiContext.exports.saveDismissedCheck("s1", true, false, 2);
  assert.deepEqual(JSON.parse(requests[0].body), { studentId: "s1", checked: true, expectedChecked: false, expectedEpoch: 2 });
  console.log("PASS: actual API client sends the dismissal epoch with the expected flag.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
