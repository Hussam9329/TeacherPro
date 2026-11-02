"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardPaste, Copy, FileText, Loader2, Plus, Send, Settings2, Trash2, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  COL,
  DEFAULT_EXTRACTOR_SETTINGS,
  FEMALE,
  MALE,
  checkRow,
  extractStudents,
  genderFromRules,
  learnGender,
  rowsToText,
  type ExtractedRow,
  type ExtractorLink,
  type ExtractorSettings,
} from "@/lib/telegram-extractor";
import { nameKey } from "@/lib/telegram-extractor/names";
import { loadExtractorSettings, saveExtractorSettings } from "@/lib/telegram-extractor/storage";
import { toast } from "@/lib/user-toast";
import "./tp-modal.css";
import "./telegram-extract-dialog.css";

const COLUMNS = [
  "اسم الطالب", "المدرسة", "الجنس", "اسم الدورة", "نظام الاشتراك", "الكورس المطلوب", "نظام الدراسة",
  "الموقع الرئيسي", "الموقع الفرعي", "الحالة", "الفرص", "رقم هاتف الطالب", "رقم ولي الأمر", "معرف التليگرام",
];
const LTR_COLUMNS = new Set<number>([COL.chances, COL.phone, COL.parentPhone, COL.telegram]);

type LinkDraft = ExtractorLink & { link: string };
type View = "main" | "links" | "settings";

const emptyLink = (link: string, course = ""): LinkDraft => ({
  link, course, program: "منهج كامل", term: "", studyType: "مدمج", baghdadRegion: "",
});
const linkLabel = (link: string) => (link ? `t.me/+${link}` : "طلاب بدون رابط كروب");
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const cleanLinkId = (value: string) => value.trim().replace(/^https?:\/\//, "").replace(/^t\.me\/\+/, "").replace(/^[/ ]+|[/ ]+$/g, "");

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="tp-modal__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function LinkFields({
  draft,
  courseNames,
  onChange,
}: {
  draft: LinkDraft;
  courseNames: string[];
  onChange: (next: LinkDraft) => void;
}) {
  const set = (patch: Partial<LinkDraft>) => onChange({ ...draft, ...patch });
  const names = draft.course && !courseNames.includes(draft.course) ? [draft.course, ...courseNames] : courseNames;
  return (
    <div className="tp-tgx__link-fields">
      <Field label="اسم الدورة">
        <select className="tp-tgx__control" value={draft.course} onChange={(event) => set({ course: event.target.value })}>
          <option value="">اختر الدورة</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </Field>
      <Field label="نظام الاشتراك">
        <select className="tp-tgx__control" value={draft.program} onChange={(event) => set({ program: event.target.value, term: event.target.value === "كورسات" ? draft.term : "" })}>
          <option value="منهج كامل">منهج كامل</option>
          <option value="كورسات">كورسات</option>
        </select>
      </Field>
      <Field label="الكورس المطلوب">
        <select className="tp-tgx__control" value={draft.term} disabled={draft.program !== "كورسات"} onChange={(event) => set({ term: event.target.value })}>
          <option value="">—</option>
          <option value="الكورس الأول">الكورس الأول</option>
          <option value="الكورس الثاني">الكورس الثاني</option>
        </select>
      </Field>
      <Field label="نظام الدراسة">
        <select className="tp-tgx__control" value={draft.studyType} onChange={(event) => set({ studyType: event.target.value })}>
          <option value="مدمج">مدمج</option>
          <option value="إلكتروني">إلكتروني</option>
        </select>
      </Field>
      <Field label="الموقع الفرعي لطلاب بغداد">
        <input
          className="tp-tgx__control"
          value={draft.baghdadRegion}
          placeholder="فارغ، أو مثلاً: بغداد - عموم بغداد"
          onChange={(event) => set({ baghdadRegion: event.target.value })}
        />
      </Field>
    </div>
  );
}

/**
 * «استخراج من رسائل التليگرام»: the desktop «مستخرج الطلاب» inside
 * «إضافة طلاب جماعية». Registration chats in, a reviewed table out, and the
 * rows go straight into the bulk add text.
 */
export function TelegramExtractDialog({
  open,
  onOpenChange,
  courseNames,
  onAddRows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names of the courses a student can be registered in. */
  courseNames: string[];
  /** Puts the rows (tab-separated text) into «إضافة طلاب جماعية». */
  onAddRows: (text: string, count: number) => void;
}) {
  const [settings, setSettings] = useState<ExtractorSettings>(DEFAULT_EXTRACTOR_SETTINGS);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [status, setStatus] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setView] = useState<View>("main");
  const [pendingLinks, setPendingLinks] = useState<LinkDraft[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<{ adminSender: string; status: string; chances: string; aliases: string; links: LinkDraft[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSettings(loadExtractorSettings());
  }, [open]);

  const store = (next: ExtractorSettings) => {
    setSettings(next);
    if (!saveExtractorSettings(next)) toast.error("ما انحفظت الإعدادات بهذا المتصفح.");
  };

  const reviewCount = useMemo(() => rows.filter((row) => Object.keys(row.warnings).length).length, [rows]);
  const visible = rows.map((row, index) => ({ row, index })).filter(({ row }) => !onlyReview || Object.keys(row.warnings).length);

  // ---------- input ----------
  const pasteClipboard = async () => {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      toast.error("المتصفح ما سمح بالقراءة من الحافظة. الصق بـ Ctrl+V.");
    }
  };
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    if (fileRef.current) fileRef.current.value = "";
  };
  const clearAll = () => {
    setText("");
    setRows([]);
    setSelected(new Set());
    setStatus("");
  };

  // ---------- extraction ----------
  const run = (current: ExtractorSettings) => {
    if (!text.trim()) {
      setStatus("الصق الرسائل أول.");
      return;
    }
    setBusy(true);
    try {
      const result = extractStudents(text, current);
      if (result.unknownLinks.length) {
        // Asked once per new group link, then remembered.
        setPendingLinks(result.unknownLinks.map((link) => emptyLink(link, courseNames[0] ?? "")));
        setView("links");
        return;
      }
      if (!result.rows.length) {
        setRows([]);
        setStatus("ما لكيت أي رسالة طالب. تأكد إن النص منسوخ ويا التاريخ واسم المرسل.");
        return;
      }
      setRows(result.rows);
      setSelected(new Set());
      setStatus("خلص ✓");
    } finally {
      setBusy(false);
    }
  };

  const saveLinks = () => {
    if (pendingLinks.some((draft) => !draft.course)) {
      toast.error("اختر الدورة لكل رابط.");
      return;
    }
    const links = { ...settings.links };
    for (const { link, ...config } of pendingLinks) links[link] = config;
    const next = { ...settings, links };
    store(next);
    setPendingLinks([]);
    setView("main");
    run(next);
  };

  // ---------- table ----------
  const editCell = (index: number, col: number, value: string) => {
    setRows((current) => {
      const next = [...current];
      const row = { ...current[index], cells: [...current[index].cells] };
      row.cells[col] = value;
      if (col === COL.name) row.note = "";
      checkRow(row);
      next[index] = row;
      return next;
    });
  };
  const tidyCell = (index: number, col: number) => editCell(index, col, rows[index].cells[col].replace(/\s+/g, " ").trim());

  /** Saves the typed gender for this first name and applies it to the same name in other rows. */
  const editGender = (index: number, gender: string) => {
    const learnedSettings: ExtractorSettings = { ...settings, learnedGenders: { ...settings.learnedGenders } };
    const name = rows[index].cells[COL.name];
    const key = learnGender(learnedSettings, name, gender);
    let others = 0;
    setRows(rows.map((row, rowIndex) => {
      const sameName = Boolean(key) && rowIndex !== index && nameKey(firstName(row.cells[COL.name])) === key
        && !genderFromRules(row.cells[COL.name], row.cells[COL.school]); // fixed rules (نور، للبنات…) are never overridden
      if (rowIndex !== index && !sameName) return row;
      if (sameName) others += 1;
      const next = { ...row, cells: [...row.cells] };
      next.cells[COL.gender] = gender;
      checkRow(next);
      return next;
    }));
    if (!key) return;
    store(learnedSettings);
    setStatus(`تعلمت: «${firstName(name)}» = ${gender} ✓${others ? ` وطبقته على ${others} سطر ثاني` : ""}`);
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    setSelected(new Set());
  };

  const toggle = (index: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });

  // ---------- output ----------
  const copyRows = async (picked: ExtractedRow[]) => {
    if (!picked.length) {
      setStatus("حدد أسطر أول.");
      return;
    }
    try {
      await navigator.clipboard.writeText(rowsToText(picked));
      setStatus(`انسخ ${picked.length} سطر ✓`);
    } catch {
      toast.error("تعذر النسخ.");
    }
  };
  const addRows = () => {
    const picked = selected.size ? rows.filter((_, index) => selected.has(index)) : rows;
    if (!picked.length) return;
    onAddRows(rowsToText(picked), picked.length);
    onOpenChange(false);
  };

  // ---------- settings ----------
  const openSettings = () => {
    setSettingsDraft({
      adminSender: settings.adminSender,
      status: settings.status,
      chances: settings.chances,
      aliases: Object.entries(settings.governorateAliases).map(([alias, name]) => `${alias} = ${name}`).join("\n"),
      links: Object.entries(settings.links).map(([link, config]) => ({ link, ...config })),
    });
    setView("settings");
  };
  const saveSettings = () => {
    if (!settingsDraft) return;
    const links: ExtractorSettings["links"] = {};
    for (const { link, ...config } of settingsDraft.links) {
      if (!config.course) continue;
      links[cleanLinkId(link)] = config;
    }
    const aliases: Record<string, string> = {};
    for (const line of settingsDraft.aliases.split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at < 0) continue;
      const alias = line.slice(0, at).trim();
      const name = line.slice(at + 1).trim();
      if (alias && name) aliases[alias] = name;
    }
    store({
      ...settings,
      adminSender: settingsDraft.adminSender.trim(),
      status: settingsDraft.status.trim(),
      chances: settingsDraft.chances.trim(),
      links,
      governorateAliases: aliases,
    });
    setView("main");
    setStatus("انحفظت الإعدادات ✓");
  };

  const close = (next: boolean) => {
    if (!next) setView("main");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="tp-modal tp-tgx" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><Wand2 /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>استخراج من رسائل التليگرام</DialogTitle>
            <DialogDescription>الصق رسائل التسجيل من التليگرام، ويطلعلك جدول نظيف ينضاف للإضافة الجماعية.</DialogDescription>
          </DialogHeader>
        </div>

        {view === "links" ? (
          <div className="tp-modal__body">
            <section className="tp-modal__section" aria-labelledby="tgx-links-title">
              <h3 id="tgx-links-title" className="tp-modal__title">رابط جديد</h3>
              <p className="tp-modal__muted">لكيت روابط كروبات جديدة. حدد إعداد كل رابط مرة وحدة، وراح ينحفظ.</p>
              {pendingLinks.map((draft, index) => (
                <div key={draft.link || "none"} className="tp-modal__panel tp-tgx__link">
                  <p className="tp-tgx__link-id" dir="ltr">{linkLabel(draft.link)}</p>
                  <LinkFields
                    draft={draft}
                    courseNames={courseNames}
                    onChange={(next) => setPendingLinks((current) => current.map((item, at) => (at === index ? next : item)))}
                  />
                </div>
              ))}
            </section>
            <div className="tp-tgx__footer">
              <Button type="button" variant="outline" onClick={() => setView("main")}>إلغاء</Button>
              <Button type="button" onClick={saveLinks}>حفظ ومتابعة</Button>
            </div>
          </div>
        ) : view === "settings" && settingsDraft ? (
          <div className="tp-modal__body">
            <section className="tp-modal__section" aria-labelledby="tgx-settings-title">
              <h3 id="tgx-settings-title" className="tp-modal__title">الإعدادات</h3>
              <div className="tp-tgx__general">
                <Field label="اسم حساب الإدارة بالتليگرام">
                  <input className="tp-tgx__control" value={settingsDraft.adminSender} onChange={(event) => setSettingsDraft({ ...settingsDraft, adminSender: event.target.value })} />
                </Field>
                <Field label="الحالة">
                  <select className="tp-tgx__control" value={settingsDraft.status} onChange={(event) => setSettingsDraft({ ...settingsDraft, status: event.target.value })}>
                    <option value="نشط">نشط</option>
                    <option value="مفصول">مفصول</option>
                  </select>
                </Field>
                <Field label="الفرص">
                  <input className="tp-tgx__control" dir="ltr" inputMode="numeric" value={settingsDraft.chances} onChange={(event) => setSettingsDraft({ ...settingsDraft, chances: event.target.value })} />
                </Field>
              </div>
            </section>
            <section className="tp-modal__section" aria-labelledby="tgx-settings-links">
              <div className="tp-modal__toolbar">
                <h3 id="tgx-settings-links" className="tp-modal__title">الروابط</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => setSettingsDraft({ ...settingsDraft, links: [...settingsDraft.links, emptyLink("")] })}>
                  <Plus className="size-4" />إضافة رابط
                </Button>
              </div>
              {settingsDraft.links.map((draft, index) => (
                <div key={index} className="tp-modal__panel tp-tgx__link">
                  <div className="tp-tgx__link-head">
                    <Field label="الرابط">
                      <input
                        className="tp-tgx__control"
                        dir="ltr"
                        value={draft.link}
                        placeholder="رمز رابط الكروب"
                        onChange={(event) => setSettingsDraft({ ...settingsDraft, links: settingsDraft.links.map((item, at) => (at === index ? { ...item, link: event.target.value } : item)) })}
                      />
                    </Field>
                    <Button type="button" size="sm" variant="ghost" aria-label="حذف الرابط" onClick={() => setSettingsDraft({ ...settingsDraft, links: settingsDraft.links.filter((_, at) => at !== index) })}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <LinkFields
                    draft={draft}
                    courseNames={courseNames}
                    onChange={(next) => setSettingsDraft({ ...settingsDraft, links: settingsDraft.links.map((item, at) => (at === index ? next : item)) })}
                  />
                </div>
              ))}
            </section>
            <section className="tp-modal__section" aria-labelledby="tgx-settings-gov">
              <h3 id="tgx-settings-gov" className="tp-modal__title">المحافظات</h3>
              <p className="tp-modal__muted">كل سطر: الكتابة = الاسم المتفق عليه. مثال: ذي قار = الناصرية</p>
              <textarea
                className="tp-tgx__control tp-tgx__aliases"
                aria-label="أسماء المحافظات البديلة"
                value={settingsDraft.aliases}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, aliases: event.target.value })}
              />
            </section>
            <div className="tp-tgx__footer">
              <Button type="button" variant="outline" onClick={() => setView("main")}>إلغاء</Button>
              <Button type="button" onClick={saveSettings}>حفظ</Button>
            </div>
          </div>
        ) : (
          <div className="tp-modal__body">
            <section className="tp-modal__section" aria-labelledby="tgx-input-title">
              <div className="tp-modal__toolbar">
                <h3 id="tgx-input-title" className="tp-modal__title">الرسائل</h3>
                <div className="tp-modal__tools">
                  <Button type="button" size="sm" variant="outline" onClick={() => void pasteClipboard()}><ClipboardPaste className="size-4" />لصق من الحافظة</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileText className="size-4" />فتح ملف نصي</Button>
                  <Button type="button" size="sm" variant="outline" onClick={clearAll}>مسح</Button>
                  <Button type="button" size="sm" variant="outline" onClick={openSettings}><Settings2 className="size-4" />الإعدادات</Button>
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(event) => void openFile(event.target.files?.[0])} />
              <textarea
                className="tp-tgx__control tp-tgx__input"
                dir="rtl"
                aria-label="رسائل التسجيل"
                value={text}
                placeholder="الصق هنا محادثات التسجيل كما هي، ويا رسائل الإدارة والروابط…"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    run(settings);
                  }
                }}
              />
              <div className="tp-tgx__run">
                <Button type="button" onClick={() => run(settings)} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  استخراج الطلاب
                </Button>
                <p className="tp-modal__muted" role="status">{status}</p>
              </div>
            </section>

            {rows.length ? (
              <section className="tp-modal__section" aria-labelledby="tgx-result-title">
                <div className="tp-modal__toolbar">
                  <h3 id="tgx-result-title" className="tp-modal__title">
                    النتيجة <span className="tp-modal__count">{rows.length} طالب • {reviewCount} بحاجة مراجعة</span>
                  </h3>
                  <label className="tp-tgx__check">
                    <Checkbox checked={onlyReview} onCheckedChange={(value) => setOnlyReview(value === true)} />
                    اعرض اللي تحتاج مراجعة بس
                  </label>
                </div>
                <div className="table-wrap tp-tgx__table-wrap" tabIndex={0} aria-label="جدول الطلاب المستخرجين">
                  <table className="tp-tgx__table">
                    <thead>
                      <tr>
                        <th scope="col"><span className="sr-only">تحديد</span></th>
                        <th scope="col">#</th>
                        {COLUMNS.map((name) => <th key={name} scope="col">{name}</th>)}
                        <th scope="col"><span className="sr-only">حذف</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(({ row, index }) => (
                        <tr key={index}>
                          <td>
                            <Checkbox aria-label={`تحديد ${row.cells[COL.name]}`} checked={selected.has(index)} onCheckedChange={(value) => toggle(index, value === true)} />
                          </td>
                          <td className="tabular-nums">{index + 1}</td>
                          {row.cells.map((cell, col) => {
                            const warning = row.warnings[col];
                            return (
                              <td key={col} data-warn={warning ? "true" : undefined} title={warning || (col === COL.name ? row.source : undefined)}>
                                {col === COL.gender ? (
                                  <select className="tp-tgx__cell" aria-label={`الجنس: ${row.cells[COL.name]}`} value={cell} onChange={(event) => editGender(index, event.target.value)}>
                                    <option value="">—</option>
                                    <option value={MALE}>{MALE}</option>
                                    <option value={FEMALE}>{FEMALE}</option>
                                  </select>
                                ) : (
                                  <input
                                    className="tp-tgx__cell"
                                    dir={LTR_COLUMNS.has(col) ? "ltr" : "rtl"}
                                    aria-label={`${COLUMNS[col]}: ${row.cells[COL.name]}`}
                                    value={cell}
                                    size={Math.max(4, Math.min(28, cell.length + 1))}
                                    onChange={(event) => editCell(index, col, event.target.value)}
                                    onBlur={() => tidyCell(index, col)}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <Button type="button" size="icon" variant="ghost" aria-label={`حذف ${row.cells[COL.name]}`} onClick={() => removeRow(index)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tp-modal__muted">الخلية الصفراء = تحتاج مراجعة (مرّر الماوس عليها تشوف السبب). تعديل الجنس ينحفظ للاسم ويتطبق على نفس الاسم.</p>
                <div className="tp-tgx__footer">
                  <Button type="button" variant="outline" onClick={() => void copyRows(rows)}><Copy className="size-4" />نسخ الكل</Button>
                  <Button type="button" variant="outline" onClick={() => void copyRows(rows.filter((_, index) => selected.has(index)))}><Copy className="size-4" />نسخ المحدد</Button>
                  <Button type="button" onClick={addRows}>
                    <Send className="size-4" />
                    {selected.size ? `إضافة ${selected.size} للإضافة الجماعية` : `إضافة ${rows.length} للإضافة الجماعية`}
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
