"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { textShortcutsApi } from "@/lib/api";
import { copyText } from "@/lib/code-closure-contact";
import {
  TEXT_SHORTCUTS_MAX,
  TEXT_SHORTCUT_LABEL_MAX,
  TEXT_SHORTCUT_TEXT_MAX,
  readTextShortcutInput,
  type TextShortcut,
} from "@/lib/text-shortcuts";
import { toast } from "@/lib/user-toast";
import { EmptyState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./text-shortcuts-dialog.css";

type Draft = { mode: "add"; id: string; label: string; text: string } | { mode: "edit"; shortcut: TextShortcut; label: string; text: string };

const COPIED_MS = 1800;

function newShortcutId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** The ids in their shown order: what the server checks before a new order. */
const revisionOf = (list: TextShortcut[]) => list.map((shortcut) => shortcut.id).join(",");

/**
 * «اختصارات»: ready texts (كليشات) for the admin and the supervisors. A click
 * on a button copies its text; «تعديل الأزرار» adds, edits, orders and deletes
 * them. Everyone with access sees the same buttons in the same order.
 */
export function TextShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formId = useId();
  const [shortcuts, setShortcuts] = useState<TextShortcut[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const runRef = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const run = ++runRef.current;
    setLoading(true);
    setLoadError("");
    const result = await textShortcutsApi.list();
    if (runRef.current !== run) return;
    setLoading(false);
    if (result.ok && result.data) {
      setShortcuts(result.data.shortcuts);
      setLoaded(true);
    } else if (!result.aborted) {
      setLoadError(result.error || "تعذر تحميل الاختصارات.");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    else runRef.current += 1;
  }, [open, load]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const copy = async (shortcut: TextShortcut, button: HTMLElement) => {
    const done = await copyText(shortcut.text, button);
    if (!done) {
      toast.error("ما انسخ النص. جرّب مرة ثانية.");
      return;
    }
    setCopiedId(shortcut.id);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(""), COPIED_MS);
    toast.success(`تم نسخ نص «${shortcut.label}»`);
  };

  // The editor opens where it is seen, also on a phone with a long list.
  const showEditor = () => requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "nearest" }));

  const startAdd = () => {
    setConfirmDeleteId("");
    setDraftError("");
    setDraft((current) => (current?.mode === "add" ? current : { mode: "add", id: newShortcutId(), label: "", text: "" }));
    showEditor();
  };

  const startEdit = (shortcut: TextShortcut) => {
    setConfirmDeleteId("");
    setDraftError("");
    setDraft({ mode: "edit", shortcut, label: shortcut.label, text: shortcut.text });
    showEditor();
  };

  const closeEditor = () => {
    setDraft(null);
    setDraftError("");
  };

  const save = async () => {
    if (!draft || saving) return;
    const input = readTextShortcutInput(draft);
    if ("error" in input) {
      setDraftError(input.error);
      return;
    }
    setSaving(true);
    setDraftError("");
    const result = draft.mode === "add"
      ? await textShortcutsApi.add(draft.id, input)
      : await textShortcutsApi.edit(draft.shortcut, input);
    setSaving(false);
    const saved = (result.data as { shortcut?: TextShortcut } | undefined)?.shortcut;
    if (!result.ok || !saved) {
      setDraftError(result.error || "تعذر حفظ الزر.");
      if (result.status === 404 || result.status === 409) void load();
      return;
    }
    setShortcuts((list) => (list.some((item) => item.id === saved.id)
      ? list.map((item) => (item.id === saved.id ? saved : item))
      : [...list, saved]));
    setDraft(null);
    toast.success(draft.mode === "add" ? `انضاف زر «${saved.label}»` : `انحفظ تعديل «${saved.label}»`);
  };

  const move = async (index: number, step: -1 | 1) => {
    const target = index + step;
    if (ordering || target < 0 || target >= shortcuts.length) return;
    const before = shortcuts;
    const next = [...before];
    [next[index], next[target]] = [next[target], next[index]];
    setShortcuts(next);
    setOrdering(true);
    const result = await textShortcutsApi.reorder(next.map((shortcut) => shortcut.id), revisionOf(before));
    setOrdering(false);
    const fresh = (result.data as { shortcuts?: TextShortcut[] } | undefined)?.shortcuts;
    if (result.ok && fresh) {
      setShortcuts(fresh);
      return;
    }
    setShortcuts(before);
    toast.error(result.error || "ما انحفظ الترتيب.");
    if (result.status === 409) void load();
  };

  const remove = async (shortcut: TextShortcut) => {
    if (deletingId) return;
    setDeletingId(shortcut.id);
    const result = await textShortcutsApi.remove(shortcut.id);
    setDeletingId("");
    if (!result.ok) {
      toast.error(result.error || "تعذر حذف الزر.");
      return;
    }
    setConfirmDeleteId("");
    if (draft?.mode === "edit" && draft.shortcut.id === shortcut.id) setDraft(null);
    setShortcuts((list) => list.filter((item) => item.id !== shortcut.id));
    toast.success(`انحذف زر «${shortcut.label}»`);
  };

  // Escape closes the innermost thing first: a delete confirmation, then the editor.
  const onEscapeKeyDown = (event: KeyboardEvent) => {
    if (confirmDeleteId && !deletingId) {
      event.preventDefault();
      setConfirmDeleteId("");
    } else if (draft && !saving) {
      event.preventDefault();
      closeEditor();
    }
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  };

  const atLimit = shortcuts.length >= TEXT_SHORTCUTS_MAX;

  const editor = (current: Draft) => (
    <div ref={editorRef} className="tp-shortcuts__editor" onKeyDown={onEditorKeyDown}>
      <h3>{current.mode === "add" ? "زر جديد" : `تعديل «${current.shortcut.label}»`}</h3>
      <label className="tp-modal__field" htmlFor={`${formId}-label`}>
        <span>اسم الزر</span>
        <Input
          id={`${formId}-label`}
          value={current.label}
          maxLength={TEXT_SHORTCUT_LABEL_MAX}
          autoFocus
          disabled={saving}
          placeholder="مثلاً: شرح الآلية"
          onChange={(event) => setDraft({ ...current, label: event.target.value })}
        />
      </label>
      <label className="tp-modal__field" htmlFor={`${formId}-text`}>
        <span>النص اللي ينسخه الزر</span>
        <textarea
          id={`${formId}-text`}
          className="tp-shortcuts__textarea"
          value={current.text}
          maxLength={TEXT_SHORTCUT_TEXT_MAX}
          rows={8}
          disabled={saving}
          placeholder="عزيزي الطالب، آلية النظام كالآتي..."
          onChange={(event) => setDraft({ ...current, text: event.target.value })}
        />
        <small className="tp-shortcuts__counter">{current.text.length} من {TEXT_SHORTCUT_TEXT_MAX} حرف</small>
      </label>
      {draftError ? (
        <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{draftError}</p></div>
      ) : null}
      <div className="tp-modal__actions">
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {saving ? "جاري الحفظ..." : current.mode === "add" ? "إضافة الزر" : "حفظ التعديل"}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={closeEditor}>
          تراجع
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-shortcuts" dir="rtl" onEscapeKeyDown={onEscapeKeyDown}>
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><MessageSquareText /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>اختصارات</DialogTitle>
            <DialogDescription>اضغط أي زر وينسخ نصه، وبعدين الصقه بالرسالة.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">{loaded ? `${shortcuts.length} زر` : ""}</span>
            <div className="tp-modal__tools">
              {loaded && shortcuts.length > 0 ? (
                <Button
                  type="button"
                  variant={managing ? "default" : "outline"}
                  size="sm"
                  aria-pressed={managing}
                  onClick={() => { setManaging((value) => !value); setConfirmDeleteId(""); }}
                >
                  <Pencil aria-hidden="true" />
                  {managing ? "خلصت التعديل" : "تعديل الأزرار"}
                </Button>
              ) : null}
              {loaded ? (
                <Button type="button" size="sm" disabled={atLimit || draft?.mode === "add"} onClick={startAdd}>
                  <Plus aria-hidden="true" />
                  زر جديد
                </Button>
              ) : null}
            </div>
          </div>

          {atLimit ? <p className="tp-modal__note">وصلت للحد ({TEXT_SHORTCUTS_MAX} زر). احذف زر حتى تضيف غيره.</p> : null}
          {draft?.mode === "add" ? editor(draft) : null}

          {loadError ? (
            <div role="alert" className="tp-modal__error">
              <AlertCircle aria-hidden="true" />
              <p>{loadError}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
                <RefreshCw aria-hidden="true" /> حاول مرة ثانية
              </Button>
            </div>
          ) : null}

          {loading && !loaded ? (
            <LoadingState title="جاري تحميل الاختصارات..." />
          ) : loaded && shortcuts.length === 0 && draft?.mode !== "add" ? (
            <EmptyState
              icon={MessageSquareText}
              title="ما كو أزرار بعد"
              description="سوِّ زر لكل كليشة تكررها، مثل «شرح الآلية»، وبضغطة وحدة ينسخ نصها."
              action={<Button type="button" onClick={startAdd}><Plus aria-hidden="true" /> زر جديد</Button>}
            />
          ) : (
            <ul className="tp-shortcuts__grid" data-managing={managing || undefined} aria-label="الاختصارات">
              {shortcuts.map((shortcut, index) => {
                if (draft?.mode === "edit" && draft.shortcut.id === shortcut.id) {
                  return <li key={shortcut.id} className="tp-shortcuts__item" data-wide="true">{editor(draft)}</li>;
                }
                const copied = copiedId === shortcut.id;
                const confirming = confirmDeleteId === shortcut.id;
                const deleting = deletingId === shortcut.id;
                return (
                  <li key={shortcut.id} className="tp-shortcuts__item" data-wide={confirming || undefined}>
                    <button
                      type="button"
                      className="tp-shortcuts__copy"
                      data-copied={copied || undefined}
                      aria-label={`انسخ نص «${shortcut.label}»`}
                      onClick={(event) => void copy(shortcut, event.currentTarget)}
                    >
                      <span className="tp-shortcuts__label">
                        <span className="tp-shortcuts__name">{shortcut.label}</span>
                        <span className="tp-shortcuts__state" aria-hidden="true">
                          {copied ? <><Check /> تم النسخ</> : <Copy />}
                        </span>
                      </span>
                      <span className="tp-shortcuts__preview">{shortcut.text}</span>
                    </button>
                    {managing ? (
                      <div className="tp-shortcuts__manage">
                        <Button type="button" variant="outline" size="sm" onClick={() => startEdit(shortcut)}>
                          <Pencil aria-hidden="true" /> تعديل
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="tp-shortcuts__delete" onClick={() => setConfirmDeleteId(shortcut.id)}>
                          <Trash2 aria-hidden="true" /> حذف
                        </Button>
                        <span className="tp-shortcuts__move">
                          <Button type="button" variant="ghost" size="icon" disabled={ordering || index === 0} aria-label={`قدّم «${shortcut.label}»`} onClick={() => void move(index, -1)}>
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" disabled={ordering || index === shortcuts.length - 1} aria-label={`أخّر «${shortcut.label}»`} onClick={() => void move(index, 1)}>
                            <ArrowDown aria-hidden="true" />
                          </Button>
                        </span>
                        {shortcut.updatedByName ? <small className="tp-shortcuts__meta">آخر تعديل: {shortcut.updatedByName}</small> : null}
                      </div>
                    ) : null}
                    {confirming ? (
                      <div className="tp-shortcuts__confirm" role="alertdialog" aria-label={`تأكيد حذف «${shortcut.label}»`}>
                        <p>ينحذف زر «{shortcut.label}» عند الكل، وما يرجع.</p>
                        <div className="tp-modal__actions">
                          <Button type="button" data-tone="danger" disabled={deleting} onClick={() => void remove(shortcut)}>
                            {deleting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                            {deleting ? "جاري الحذف..." : "تأكيد الحذف"}
                          </Button>
                          <Button type="button" variant="ghost" disabled={deleting} onClick={() => setConfirmDeleteId("")}>
                            تراجع
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
