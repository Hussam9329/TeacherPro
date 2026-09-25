"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // Rich toasts use the same four meanings as the rest of the system.
          "--success-bg": "var(--status-success-bg)",
          "--success-text": "var(--status-success-fg)",
          "--success-border": "var(--status-success-border)",
          "--warning-bg": "var(--status-warning-bg)",
          "--warning-text": "var(--status-warning-fg)",
          "--warning-border": "var(--status-warning-border)",
          "--error-bg": "var(--status-danger-bg)",
          "--error-text": "var(--status-danger-fg)",
          "--error-border": "var(--status-danger-border)",
          "--info-bg": "var(--status-info-bg)",
          "--info-text": "var(--status-info-fg)",
          "--info-border": "var(--status-info-border)",
        } as React.CSSProperties
      }
      duration={4500}
      {...props}
    />
  );
};

export { Toaster };
