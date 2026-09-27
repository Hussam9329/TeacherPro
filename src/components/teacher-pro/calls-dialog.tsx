"use client";

import { PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CallsWorkspace } from "./follow-up";
import "./tp-modal.css";
import "./calls.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** «إدارة المكالمات»: the calls tab's work list, opened from the dashboard. */
export function CallsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-calls-window" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><PhoneCall /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>إدارة المكالمات</DialogTitle>
          </DialogHeader>
        </div>
        <div className="tp-modal__body">
          {open && <CallsWorkspace variant="window" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
