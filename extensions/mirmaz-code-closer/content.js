// «إغلاق كود مرماز»: the danger button of «اغلاق الكودات» in TeacherPro opens
// …/teachers/users/active#tp-close=00964…. This script searches the users
// table for that phone, lists the rows it found and, once the user confirms,
// switches off «حالة الدورة للطالب» on the chosen rows (the same switch
// clicked by hand), then reloads the table to check the platform saved it.
//
// The platform's switch toggles on the server (no on/off is sent), so a row is
// clicked only while the freshly loaded table shows it on, and never twice.
(function mirmazCodeCloser() {
  "use strict";

  const REQUEST_KEY = "tp-close-request";
  const REQUEST_MAX_AGE_MS = 10 * 60 * 1000;
  const ACTIVE_USERS_PATH = /\/teachers\/users\/active\/?$/;
  const SAVED_ALERT_TEXT = "تم تغيير حالة الدورة";

  /** 009647705550679, 9647705550679, 07705550679, ٠٧٧… → 7705550679. */
  function nationalNumber(value) {
    const digits = String(value ?? "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
      .replace(/\D/g, "");
    return digits.replace(/^(?:00964|964|0)/, "");
  }

  /** The phone TeacherPro put in the link, or "". */
  function phoneFromHash(hash) {
    const match = /(?:^#|&)tp-close=(00964\d{9,10})(?:&|$)/.exec(hash || "");
    return match ? match[1] : "";
  }

  function isFreshRequest(request, now) {
    return Boolean(
      request && typeof request.phone === "string" && request.phone
      && typeof request.at === "number" && now >= request.at && now - request.at <= REQUEST_MAX_AGE_MS,
    );
  }

  /** The search matches any part of a number, so only an exact phone is chosen by default. */
  function planRows(rows, phone) {
    const wanted = nationalNumber(phone);
    return rows.map((row) => ({ ...row, exact: Boolean(wanted) && nationalNumber(row.mobile) === wanted }));
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fire = (element, type) => element.dispatchEvent(new Event(type, { bubbles: true }));

  function tableParts() {
    const table = document.querySelector("table.yajra-datatable");
    const wrapper = table && table.closest(".dataTables_wrapper");
    const search = wrapper && wrapper.querySelector(".dataTables_filter input");
    if (!search || !table.tBodies[0]) return null;
    return {
      table,
      search,
      length: wrapper.querySelector(".dataTables_length select"),
      processing: wrapper.querySelector(".dataTables_processing"),
      info: wrapper.querySelector(".dataTables_info"),
    };
  }

  const isBusy = (parts) => Boolean(parts.processing && getComputedStyle(parts.processing).display !== "none");
  const snapshot = (parts) => `${parts.info ? parts.info.textContent : ""}|${parts.table.tBodies[0].innerHTML}`;

  async function waitForTable(timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const parts = tableParts();
      if (parts && !isBusy(parts) && parts.table.tBodies[0].rows.length) return parts;
      await sleep(200);
    }
    throw new Error("the users table did not load");
  }

  async function waitIdle(parts, timeoutMs = 20000) {
    const started = Date.now();
    while (isBusy(parts) && Date.now() - started < timeoutMs) await sleep(150);
  }

  /** Runs a change that makes the table load again, and waits for the new rows. */
  async function reload(parts, change) {
    const before = snapshot(parts);
    change();
    const started = Date.now();
    await sleep(250);
    while (Date.now() - started < 20000) {
      if (!isBusy(parts) && (snapshot(parts) !== before || Date.now() - started > 2500)) return;
      await sleep(150);
    }
    throw new Error("the users table did not reload");
  }

  /** The page's filters reload the table on change; one already set is left alone. */
  async function setSelect(parts, select, value) {
    if (!select || select.value === value || ![...select.options].some((option) => option.value === value)) return;
    await reload(parts, () => {
      select.value = value;
      fire(select, "change");
    });
  }

  /** Loads the rows again from the platform: the page-length list reloads even with the same value. */
  function redraw(parts) {
    const trigger = parts.length || document.getElementById("year-filter");
    return reload(parts, () => fire(trigger, "change"));
  }

  function searchFor(parts, term) {
    if (parts.search.value === term) return redraw(parts);
    return reload(parts, () => {
      parts.search.value = term;
      fire(parts.search, "input");
    });
  }

  function readRows(parts) {
    const titles = [...parts.table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
    const nameAt = titles.indexOf("الاسم");
    const courseAt = titles.indexOf("اسم الدورة");
    const mobileAt = titles.indexOf("رقم الجوال");
    const text = (row, index) => (index >= 0 && row.cells[index] ? row.cells[index].textContent.trim() : "");
    return [...parts.table.tBodies[0].rows].flatMap((row) => {
      const toggle = row.querySelector(".custom-switch[data-id]");
      const input = toggle && toggle.querySelector('input[type="checkbox"]');
      if (!input) return [];
      return [{
        key: `${toggle.getAttribute("data-id")}:${toggle.getAttribute("data-course_id")}`,
        name: text(row, nameAt),
        course: text(row, courseAt),
        mobile: text(row, mobileAt),
        active: input.checked,
        input,
      }];
    });
  }

  const savedAlertShown = () => [...document.querySelectorAll(".swal2-popup")]
    .some((popup) => popup.textContent.includes(SAVED_ALERT_TEXT));

  /** The page confirms each saved switch with a «تم تغيير حالة الدورة للشخص» alert. */
  function waitForSavedAlert(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (savedAlertShown()) finish(true);
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
      function finish(saved) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(saved);
      }
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function closeRows(parts, chosen) {
    for (const wanted of chosen) {
      await waitIdle(parts);
      const row = readRows(parts).find((item) => item.key === wanted.key);
      if (!row || !row.active) continue;
      for (let waited = 0; savedAlertShown() && waited < 3000; waited += 150) await sleep(150);
      const saved = waitForSavedAlert();
      row.input.click();
      await saved;
    }
    // Judge by what the platform sends back, not by the switch on screen.
    let now = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await redraw(parts);
      now = readRows(parts);
      if (chosen.every((wanted) => now.some((item) => item.key === wanted.key && !item.active))) break;
      await sleep(1500);
    }
    const after = (wanted) => now.find((item) => item.key === wanted.key);
    return {
      closed: chosen.filter((wanted) => after(wanted) && !after(wanted).active).map((wanted) => ({ ...wanted, active: false })),
      failed: chosen.filter((wanted) => !after(wanted) || after(wanted).active),
    };
  }

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "className") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    children.flat().forEach((child) => {
      if (child !== undefined && child !== null && child !== false) node.append(child instanceof Node ? child : String(child));
    });
    return node;
  }

  const ltr = (text) => h("bdi", { dir: "ltr" }, text);

  const STYLES = `
    :host { all: initial; }
    .panel { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
      background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 14px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, .25); font: 14px/1.6 Tahoma, "Segoe UI", Arial, sans-serif; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px;
      background: #fef2f2; border-bottom: 1px solid #fee2e2; border-radius: 14px 14px 0 0; }
    header strong { color: #b91c1c; font-size: 15px; }
    .x { border: 0; background: transparent; color: #6b7280; font-size: 22px; line-height: 1; padding: 0 4px; cursor: pointer; }
    .x:disabled { opacity: .4; cursor: not-allowed; }
    .body { padding: 12px 16px; }
    .body p { margin: 0 0 8px; }
    .rows { display: grid; gap: 8px; margin-top: 4px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px; cursor: pointer; }
    .row--off { background: #f9fafb; cursor: default; }
    .row input { flex: none; width: 18px; height: 18px; accent-color: #dc2626; }
    .row__main { display: grid; flex: 1; min-width: 0; }
    .row__main small { color: #6b7280; overflow-wrap: anywhere; }
    .badge { flex: none; padding: 2px 8px; border-radius: 999px; background: #e5e7eb; color: #374151; font-size: 12px; }
    .badge--on { background: #dcfce7; color: #166534; }
    .warn { color: #b45309; font-style: normal; }
    .error { color: #b91c1c; }
    .ok { color: #15803d; font-weight: bold; }
    .muted { color: #6b7280; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 14px; }
    .actions:empty { display: none; }
    .danger, .secondary { font: inherit; padding: 8px 16px; border: 1px solid transparent; border-radius: 10px; cursor: pointer; }
    .danger { background: #dc2626; color: #fff; }
    .danger:disabled { opacity: .5; cursor: not-allowed; }
    .secondary { background: #fff; color: #374151; border-color: #d1d5db; }
  `;

  function openPanel() {
    const old = document.getElementById("tp-mz-closer");
    if (old) old.remove();
    const host = h("div", { id: "tp-mz-closer" });
    const root = host.attachShadow({ mode: "open" });
    const body = h("div", { className: "body" });
    const actions = h("div", { className: "actions" });
    const close = () => host.remove();
    const x = h("button", { type: "button", className: "x", "aria-label": "إغلاق النافذة", onclick: close }, "×");
    root.append(
      h("style", null, STYLES),
      h("section", { className: "panel", dir: "rtl", role: "dialog", "aria-label": "إغلاق كود الطالب" },
        h("header", null, h("strong", null, "TeacherPro · إغلاق كود الطالب"), x),
        body,
        actions),
    );
    document.body.append(host);
    return {
      show(content, buttons = []) {
        body.replaceChildren(...[content].flat());
        actions.replaceChildren(...buttons);
      },
      setBusy(busy) { x.disabled = busy; },
      okButton: () => h("button", { type: "button", className: "secondary", onclick: close }, "حسناً"),
      cancelButton: () => h("button", { type: "button", className: "secondary", onclick: close }, "إلغاء"),
    };
  }

  function rowItem(row, selectable, checked) {
    return h("label", { className: selectable ? "row" : "row row--off" },
      selectable ? h("input", { type: "checkbox", checked, "data-key": row.key }) : null,
      h("span", { className: "row__main" },
        h("strong", null, row.name || "بدون اسم"),
        h("small", null, row.course || "دورة غير معروفة"),
        h("small", null, ltr(row.mobile || "—"), row.exact === false ? h("em", { className: "warn" }, " — الرقم غير مطابق تماماً") : null)),
      h("span", { className: row.active ? "badge badge--on" : "badge" }, row.active ? "فعّال" : "مغلق"));
  }

  async function run(phone) {
    const panel = openPanel();
    panel.show(h("p", null, "جاري البحث عن الطالب بالرقم ", ltr(phone), " …"));
    let parts;
    try {
      parts = await waitForTable();
      await setSelect(parts, document.getElementById("year-filter"), ""); // a student who joined in an earlier year
      await setSelect(parts, document.getElementById("status-filter"), ""); // closed rows too, to say so
      await setSelect(parts, parts.length, "50");
      await searchFor(parts, nationalNumber(phone));
    } catch {
      panel.show(h("p", { className: "error" }, "تعذر البحث في جدول الطلاب. ابحث يدوياً بالرقم ", ltr(phone)), [panel.okButton()]);
      return;
    }

    const rows = planRows(readRows(parts), phone);
    if (!rows.length) {
      panel.show([
        h("p", { className: "error" }, "لا يوجد طالب بالرقم ", ltr(phone), " في مرماز."),
        h("p", { className: "muted" }, "ابحث عنه بالاسم يدوياً."),
      ], [panel.okButton()]);
      return;
    }
    if (!rows.some((row) => row.active)) {
      panel.show([
        h("p", { className: "ok" }, "كود الطالب مغلق مسبقاً في مرماز ✓"),
        h("div", { className: "rows" }, rows.map((row) => rowItem(row, false, false))),
      ], [panel.okButton()]);
      return;
    }

    const list = h("div", { className: "rows" }, rows.map((row) => rowItem(row, row.active, row.active && row.exact)));
    const chosenKeys = () => [...list.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.getAttribute("data-key"));
    const confirm = h("button", { type: "button", className: "danger" });
    const refresh = () => {
      const count = chosenKeys().length;
      confirm.disabled = !count;
      confirm.textContent = count > 1 ? `تأكيد إغلاق الكود (${count} دورات)` : "تأكيد إغلاق الكود";
    };
    list.addEventListener("change", refresh);
    refresh();

    confirm.addEventListener("click", async () => {
      const keys = chosenKeys();
      const chosen = rows.filter((row) => keys.includes(row.key));
      if (!chosen.length) return;
      panel.setBusy(true);
      panel.show(h("p", null, "جاري إغلاق الكود …"));
      try {
        const { closed, failed } = await closeRows(parts, chosen);
        panel.show([
          closed.length ? h("p", { className: "ok" }, "تم إغلاق الكود ✓") : null,
          closed.length ? h("div", { className: "rows" }, closed.map((row) => rowItem(row, false, false))) : null,
          failed.length ? h("p", { className: "error" }, "لم يُغلق الكود هنا، أغلقه يدوياً من الجدول:") : null,
          failed.length ? h("div", { className: "rows" }, failed.map((row) => rowItem(row, false, false))) : null,
        ], [panel.okButton()]);
      } catch {
        panel.show(h("p", { className: "error" }, "حدث خطأ أثناء الإغلاق. حدّث الصفحة وتأكد من حالة الطالب يدوياً."), [panel.okButton()]);
      } finally {
        panel.setBusy(false);
      }
    });

    panel.show([
      h("p", null, "نتائج البحث بالرقم ", ltr(phone), ":"),
      rows.some((row) => row.active && row.exact)
        ? null
        : h("p", { className: "warn" }, "لا يوجد رقم مطابق تماماً؛ تأكد من الاسم قبل أن تختار."),
      list,
      h("p", { className: "muted" }, "اختر الدورة التي تريد إغلاق كودها ثم اضغط تأكيد."),
    ], [confirm, panel.cancelButton()]);
  }

  function start() {
    const fromLink = phoneFromHash(location.hash);
    let request = fromLink ? { phone: fromLink, at: Date.now() } : null;
    if (fromLink) {
      try {
        sessionStorage.setItem(REQUEST_KEY, JSON.stringify(request));
      } catch {}
      // The phone leaves the address bar and the history entry.
      history.replaceState(history.state, "", location.pathname + location.search);
    }
    // On the sign-in page the request waits in this tab for the users page.
    if (!ACTIVE_USERS_PATH.test(location.pathname)) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(REQUEST_KEY) || "null");
      sessionStorage.removeItem(REQUEST_KEY); // a reload never asks again
      request = request || stored;
    } catch {}
    if (isFreshRequest(request, Date.now())) void run(request.phone);
  }

  const api = { REQUEST_MAX_AGE_MS, nationalNumber, phoneFromHash, isFreshRequest, planRows };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else start();
})();
