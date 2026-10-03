"use client";

import type { ComponentType, ReactNode } from "react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import "./tp-modal.css";

type HeroIcon = ComponentType<{ className?: string }>;

/**
 * The header of an add/edit window: the management windows' dark band with
 * an icon, the title and one line of what the window does. Put it first in
 * a `DialogContent` (or `AlertDialogContent` with `alert`) that carries
 * `tp-form-dialog`, then the form in `tp-form-dialog__body`, then the footer.
 */
export function FormDialogHero({
  icon: Icon,
  title,
  description,
  alert = false,
}: {
  icon: HeroIcon;
  title: ReactNode;
  description?: ReactNode;
  alert?: boolean;
}) {
  const Header = alert ? AlertDialogHeader : DialogHeader;
  const Title = alert ? AlertDialogTitle : DialogTitle;
  const Description = alert ? AlertDialogDescription : DialogDescription;
  return (
    <div className="tp-modal__hero">
      <span className="tp-modal__hero-icon" aria-hidden="true">
        <Icon />
      </span>
      <Header className="tp-modal__heading">
        <Title>{title}</Title>
        {description ? <Description>{description}</Description> : null}
      </Header>
    </div>
  );
}
