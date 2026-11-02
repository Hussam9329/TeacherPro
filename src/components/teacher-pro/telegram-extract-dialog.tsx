"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Settings2, Trash2, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  extractStudents,
  rowsToText,
  type ExtractorLink,
  type ExtractorSettings,
} from "@/lib/telegram-extractor";
import { loadExtractorSettings, saveExtractorSettings } from "@/lib/telegram-extractor/storage";
import { telegramExtractorApi } from "@/lib/api";
import { toast } from "@/lib/user-toast";
import "./tp-modal.css";
import "./telegram-extract-dialog.css";

type LinkDraft = ExtractorLink & { link: string };
type SettingsDraft = { adminSender: string; status: string; chances: string; grace: string; aliases: string; links: LinkDraft[] };
type Extracted = { text: string; count: number; notes: string[] };

const emptyLink = (link: string, course = ""): LinkDraft => ({
  link, course, program: "منهج كامل", term: "", studyType: "مدمج", baghdadRegion: "",
});
const linkLabel = (link: string) => (link ? `t.me/+${link}` : "طلاب بدون رابط كروب");
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
 * «استخراج من رسائل التليگرام» inside «إضافة طلاب جماعية»: registration chats
 * pasted into the bulk add box become its rows (as the desktop «مستخرج الطلاب»
 * wrote them), and the bulk add's own check shows every row. The window opens
 * only to set up a new group link (once) or for «الإعدادات».
 */
export function useTelegramExtractor({
  courseNames,
  onExtracted,
}: {
  /** Names of the courses a student can be registered in. */
  courseNames: string[];
  /** The box's new text: its rows already there, then the extracted students. */
  onExtracted: (result: Extracted) => void;
}) {
  const [view, setView] = useState<"links" | "settings" | null>(null);
  const [pendingLinks, setPendingLinks] = useState<LinkDraft[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const waiting = useRef("");
  /** Links kept on the server; the ones set up in this browser come on top. */
  const serverLinks = useRef<Promise<ExtractorSettings["links"]> | null>(null);

  useEffect(() => {
    serverLinks.current = telegramExtractorApi.links().then((data) => data?.links ?? {});
  }, []);

  const currentSettings = async (): Promise<ExtractorSettings> => {
    const local = loadExtractorSettings();
    const server = (await serverLinks.current) ?? {};
    return { ...local, links: { ...server, ...local.links } };
  };

  const store = (next: ExtractorSettings) => {
    if (!saveExtractorSettings(next)) toast.error("ما انحفظت الإعدادات بهذا المتصفح.");
  };

  /** Turns the Telegram messages in `text` into rows; lines that are rows already stay as they are. */
  const extract = async (text: string) => {
    const lines = text.split(/\r?\n/);
    const kept = lines.filter((line) => line.includes("\t"));
    const chat = lines.filter((line) => !line.includes("\t")).join("\n");
    const settings = await currentSettings();
    const result = extractStudents(chat, settings);
    if (result.unknownLinks.length) {
      // Asked once per new group link, then remembered.
      waiting.current = text;
      setPendingLinks(result.unknownLinks.map((link) => emptyLink(link)));
      setView("links");
      return;
    }
    if (!result.rows.length) {
      toast.warning("ما لكيت أي رسالة طالب", { description: "تأكد إن النص منسوخ ويا التاريخ واسم المرسل." });
      return;
    }
    onExtracted({
      text: [...kept, rowsToText(result.rows)].join("\n"),
      count: result.rows.length,
      notes: result.rows.filter((row) => row.note).map((row) => `${row.cells[0]}: ${row.note}`),
    });
  };

  const saveLinks = async () => {
    if (pendingLinks.some((draft) => !draft.course)) {
      toast.warning("اختر الدورة لكل رابط.");
      return;
    }
    const local = loadExtractorSettings();
    for (const { link, ...config } of pendingLinks) local.links[link] = config;
    store(local);
    setPendingLinks([]);
    setView(null);
    await extract(waiting.current);
  };

  const openSettings = async () => {
    const settings = await currentSettings();
    setSettingsDraft({
      adminSender: settings.adminSender,
      status: settings.status,
      chances: settings.chances,
      grace: settings.grace,
      aliases: Object.entries(settings.governorateAliases).map(([alias, name]) => `${alias} = ${name}`).join("\n"),
      links: Object.entries(settings.links).map(([link, config]) => ({ link, ...config })),
    });
    setView("settings");
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    const server = (await serverLinks.current) ?? {};
    const links: ExtractorSettings["links"] = {};
    for (const { link, ...config } of settingsDraft.links) {
      const id = cleanLinkId(link);
      if (!config.course || JSON.stringify(server[id]) === JSON.stringify(config)) continue; // the server keeps those
      links[id] = config;
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
      ...loadExtractorSettings(),
      adminSender: settingsDraft.adminSender.trim(),
      status: settingsDraft.status.trim(),
      chances: settingsDraft.chances.trim(),
      grace: settingsDraft.grace.trim(),
      links,
      governorateAliases: aliases,
    });
    setView(null);
    toast.success("انحفظت إعدادات الاستخراج");
  };

  const editLink = (index: number, patch: Partial<LinkDraft>) => {
    if (!settingsDraft) return;
    setSettingsDraft({ ...settingsDraft, links: settingsDraft.links.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  };

  const dialog = (
    <Dialog open={view !== null} onOpenChange={(open) => !open && setView(null)}>
      <DialogContent className="tp-modal tp-tgx" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true">{view === "settings" ? <Settings2 /> : <Wand2 />}</span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>{view === "settings" ? "إعدادات الاستخراج" : "رابط جديد"}</DialogTitle>
            <DialogDescription>
              {view === "settings"
                ? "الإعدادات الي تنكتب لكل طالب ينستخرج من رسائل التليگرام."
                : "لكيت روابط كروبات جديدة. حدد إعداد كل رابط مرة وحدة، وراح ينحفظ."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {view === "links" ? (
          <div className="tp-modal__body">
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
            <div className="tp-tgx__footer">
              <Button type="button" variant="outline" onClick={() => setView(null)}>إلغاء</Button>
              <Button type="button" onClick={() => void saveLinks()}>حفظ ومتابعة</Button>
            </div>
          </div>
        ) : view === "settings" && settingsDraft ? (
          <div className="tp-modal__body">
            <section className="tp-modal__section" aria-label="عام">
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
                <Field label="السماح">
                  <input className="tp-tgx__control" value={settingsDraft.grace} onChange={(event) => setSettingsDraft({ ...settingsDraft, grace: event.target.value })} />
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
                      <input className="tp-tgx__control" dir="ltr" value={draft.link} placeholder="رمز رابط الكروب" onChange={(event) => editLink(index, { link: event.target.value })} />
                    </Field>
                    <Button type="button" size="sm" variant="ghost" aria-label="حذف الرابط" onClick={() => setSettingsDraft({ ...settingsDraft, links: settingsDraft.links.filter((_, at) => at !== index) })}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <LinkFields draft={draft} courseNames={courseNames} onChange={(next) => editLink(index, next)} />
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
              <Button type="button" variant="outline" onClick={() => setView(null)}>إلغاء</Button>
              <Button type="button" onClick={() => void saveSettings()}>حفظ</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );

  return { extract, openSettings: () => void openSettings(), dialog };
}
