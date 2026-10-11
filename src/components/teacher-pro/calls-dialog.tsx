"use client";

import { useEffect, useState } from "react";
import { BarChart3, PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CallsWorkspace } from "./follow-up";
import { CallsStatsPanel } from "./calls-stats-panel";
import "./tp-modal.css";
import "./calls.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The admin and the supervisors also get «الإحصائيات». */
  canSeeStats?: boolean;
};

/** «إدارة المكالمات»: the calls tab's work list, opened from the dashboard. */
export function CallsDialog({ open, onOpenChange, canSeeStats = false }: Props) {
  const [view, setView] = useState<"calls" | "stats">("calls");
  useEffect(() => {
    if (!open) setView("calls");
  }, [open]);
  const stats = canSeeStats && view === "stats";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-calls-window" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true">{stats ? <BarChart3 /> : <PhoneCall />}</span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>{stats ? "إحصائيات المكالمات" : "إدارة المكالمات"}</DialogTitle>
          </DialogHeader>
          {canSeeStats ? (
            <button
              type="button"
              className="tp-cstats__switch"
              aria-pressed={stats}
              onClick={() => setView(stats ? "calls" : "stats")}
            >
              {stats ? <PhoneCall aria-hidden="true" /> : <BarChart3 aria-hidden="true" />}
              {stats ? "قائمة المكالمات" : "الإحصائيات"}
            </button>
          ) : null}
        </div>
        <div className="tp-modal__body">
          {open && (stats ? <CallsStatsPanel /> : <CallsWorkspace variant="window" />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
