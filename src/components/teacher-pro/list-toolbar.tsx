"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "./tp-list.css";

export type ListChipTone = "success" | "warning" | "danger" | "info" | "muted";

/** One filter button: its label, how many records it holds, and its colour. */
export type ListChip = {
  key: string;
  label: string;
  count?: number | null;
  tone?: ListChipTone;
  hint?: string;
};

/** A filter that is on, shown as a small button that removes it. */
export type ActiveFilter = {
  key: string;
  label: string;
  onClear: () => void;
};

function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/** The filter buttons that carry their count, on their own (e.g. above a sheet). */
export function ListChips({
  label,
  chips,
  activeChip,
  onChipChange,
  className,
}: {
  label: string;
  chips: ListChip[];
  activeChip?: string;
  onChipChange?: (key: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={className ? `tp-list-chips ${className}` : "tp-list-chips"}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="tp-list-chip"
          data-tone={chip.tone}
          aria-pressed={activeChip === chip.key}
          title={chip.hint}
          onClick={() => onChipChange?.(chip.key)}
        >
          {chip.tone ? <span className="tp-list-chip__dot" aria-hidden="true" /> : null}
          <span>{chip.label}</span>
          {chip.count !== undefined && chip.count !== null ? (
            <span className="tp-list-chip__count">{chip.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's search line: the page's own search box (it keeps its Ctrl+F and
 * typing behaviour), «تصفية» for the less used filters, the page actions,
 * filter buttons that carry their count, and one sentence of what is shown.
 * On phones the filters open from the bottom so the list comes first.
 */
export function ListToolbar({
  label,
  search,
  actions,
  chips,
  activeChip,
  onChipChange,
  chipsLabel = "تصفية سريعة",
  filters,
  activeFilterCount = 0,
  onClearFilters,
  summary,
  filtersTitle = "تصفية",
  activeFilters,
}: {
  label: string;
  search?: ReactNode;
  actions?: ReactNode;
  chips?: ListChip[];
  activeChip?: string;
  onChipChange?: (key: string) => void;
  chipsLabel?: string;
  filters?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  summary?: ReactNode;
  filtersTitle?: string;
  activeFilters?: ActiveFilter[];
}) {
  const [open, setOpen] = useState(false);
  const phone = usePhoneLayout();
  const panelId = useId();

  return (
    <section className="tp-list-toolbar" aria-label={label}>
      <div className="tp-list-toolbar__row">
        {search ? <div className="tp-list-toolbar__search">{search}</div> : null}
        {filters ? (
          <Button
            type="button"
            variant="outline"
            className="tp-list-filter-btn"
            aria-expanded={open}
            aria-controls={phone ? undefined : panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <SlidersHorizontal aria-hidden="true" />
            تصفية
            {activeFilterCount > 0 ? (
              <span className="tp-list-filter-btn__count" aria-label={`${activeFilterCount} فلتر مفعّل`}>
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        {actions ? <div className="tp-list-toolbar__actions">{actions}</div> : null}
      </div>

      {chips && chips.length > 0 ? (
        <ListChips label={chipsLabel} chips={chips} activeChip={activeChip} onChipChange={onChipChange} />
      ) : null}

      {activeFilters && activeFilters.length > 0 ? (
        <ul className="tp-list-active" aria-label="الفلاتر الشغالة">
          {activeFilters.map((filter) => (
            <li key={filter.key}>
              <button
                type="button"
                className="tp-list-active__chip"
                onClick={filter.onClear}
                aria-label={`إزالة فلتر ${filter.label}`}
              >
                <span>{filter.label}</span>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {filters && !phone && open ? (
        <div id={panelId} className="tp-list-panel">
          {filters}
          {onClearFilters && activeFilterCount > 0 ? (
            <div className="tp-list-panel__foot">
              <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
                مسح الفلاتر
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {filters && phone ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="top-auto bottom-0 left-0 max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-3xl sm:w-full">
            <DialogHeader>
              <DialogTitle>{filtersTitle}</DialogTitle>
            </DialogHeader>
            <div className="tp-list-sheet__fields">{filters}</div>
            <DialogFooter className="flex-row gap-2 [&>[data-slot=button]]:w-auto">
              <Button type="button" className="flex-1" onClick={() => setOpen(false)}>
                تطبيق
              </Button>
              {onClearFilters ? (
                <Button type="button" variant="outline" onClick={onClearFilters} disabled={activeFilterCount === 0}>
                  مسح
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {summary ? (
        <p className="tp-list-summary" aria-live="polite">
          {summary}
        </p>
      ) : null}
    </section>
  );
}
