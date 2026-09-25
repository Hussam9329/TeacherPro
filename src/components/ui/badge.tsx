import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit max-w-full min-w-0 flex-wrap items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-center text-xs font-semibold leading-5 whitespace-normal break-words [overflow-wrap:anywhere] [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow,background-color,border-color]",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm shadow-primary/20 [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-danger-solid text-danger-on shadow-sm shadow-danger-vivid/30 [a&]:hover:bg-danger-solid/90 focus-visible:ring-danger-vivid/30",
        outline:
          "border-primary/25 bg-background/60 text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        success:
          "border-success-line bg-success-soft text-success",
        warning:
          "border-warning-line bg-warning-soft text-warning",
        danger:
          "border-danger-line bg-danger-soft text-danger",
        info:
          "border-info-line bg-info-soft text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeProps = React.ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "span"

    return (
      <Comp
        ref={ref}
        data-slot="badge"
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    )
  }
)
Badge.displayName = "Badge"

export { Badge, badgeVariants }
