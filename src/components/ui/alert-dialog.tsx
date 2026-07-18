"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  dir,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        dir={dir ?? "rtl"}
        className={cn(
          "bg-popover/95 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-5 overflow-y-auto overscroll-contain rounded-2xl border border-border/80 p-5 shadow-2xl backdrop-blur-xl duration-200 sm:max-w-lg sm:p-6 [&>[data-slot=alert-dialog-footer]]:sticky [&>[data-slot=alert-dialog-footer]]:bottom-0 [&>[data-slot=alert-dialog-footer]]:z-10 [&>[data-slot=alert-dialog-footer]]:-mx-5 [&>[data-slot=alert-dialog-footer]]:-mb-5 [&>[data-slot=alert-dialog-footer]]:border-t [&>[data-slot=alert-dialog-footer]]:bg-popover/95 [&>[data-slot=alert-dialog-footer]]:px-5 [&>[data-slot=alert-dialog-footer]]:py-4 [&>[data-slot=alert-dialog-footer]]:backdrop-blur-xl sm:[&>[data-slot=alert-dialog-footer]]:-mx-6 sm:[&>[data-slot=alert-dialog-footer]]:-mb-6 sm:[&>[data-slot=alert-dialog-footer]]:px-6 [&>[data-slot=alert-dialog-header]]:sticky [&>[data-slot=alert-dialog-header]]:top-0 [&>[data-slot=alert-dialog-header]]:z-10 [&>[data-slot=alert-dialog-header]]:-mx-5 [&>[data-slot=alert-dialog-header]]:-mt-5 [&>[data-slot=alert-dialog-header]]:border-b [&>[data-slot=alert-dialog-header]]:bg-popover/95 [&>[data-slot=alert-dialog-header]]:px-5 [&>[data-slot=alert-dialog-header]]:py-4 [&>[data-slot=alert-dialog-header]]:backdrop-blur-xl sm:[&>[data-slot=alert-dialog-header]]:-mx-6 sm:[&>[data-slot=alert-dialog-header]]:-mt-6 sm:[&>[data-slot=alert-dialog-header]]:px-6",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-right", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>[data-slot=alert-dialog-action]]:w-full [&>[data-slot=alert-dialog-cancel]]:w-full sm:[&>[data-slot=alert-dialog-action]]:w-auto sm:[&>[data-slot=alert-dialog-cancel]]:w-auto",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-bold leading-7", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm leading-6", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants(), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
