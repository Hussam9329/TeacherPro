"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./tp-list.css";

export type RowAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Risky actions sit last, in red, after a line. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * «⋯»: the actions a record needs now and then. The everyday action stays a
 * visible button on the card; risky ones live here, last and in red, and each
 * still opens its own confirmation that says what will happen.
 */
export function RowActionsMenu({
  label,
  actions,
}: {
  label: string;
  actions: RowAction[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const safe = actions.filter((action) => !action.danger);
  const risky = actions.filter((action) => action.danger);

  useEffect(() => {
    if (!open) return;
    const items = () =>
      Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const list = items();
      if (!list.length) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? list.length - 1
        : event.key === "ArrowDown" ? (index + 1) % list.length
        : (index - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!actions.length) return null;

  const renderItem = (action: RowAction) => (
    <button
      key={action.key}
      type="button"
      role="menuitem"
      className="tp-row-menu__item"
      data-danger={action.danger ? "true" : undefined}
      disabled={action.disabled}
      onClick={() => {
        setOpen(false);
        action.onSelect();
      }}
    >
      {action.icon}
      {action.label}
    </button>
  );

  return (
    <div className="tp-row-menu" ref={rootRef}>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className="tp-row-menu__list">
          {safe.map(renderItem)}
          {safe.length > 0 && risky.length > 0 ? <div className="tp-row-menu__sep" role="separator" /> : null}
          {risky.map(renderItem)}
        </div>
      ) : null}
    </div>
  );
}
