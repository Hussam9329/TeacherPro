import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "surface-card text-card-foreground flex w-full max-w-full min-w-0 flex-col gap-5 py-5 md:gap-6 md:py-6",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid min-w-0 auto-rows-min grid-cols-1 items-start gap-2 px-4 sm:px-5 md:px-6 sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:pb-5 md:[.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("min-w-0 break-words font-bold leading-snug tracking-tight [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-1 min-w-0 self-start justify-self-stretch sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end [&>[data-slot=button]]:w-full sm:[&>[data-slot=button]]:w-auto",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0 px-4 sm:px-5 md:px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex min-w-0 flex-col-reverse items-stretch gap-2 px-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-5 md:px-6 [&>[data-slot=button]]:w-full sm:[&>[data-slot=button]]:w-auto [.border-t]:pt-5 md:[.border-t]:pt-6",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
