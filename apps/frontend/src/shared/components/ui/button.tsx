import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { LoaderCircle } from "lucide-react"
import { cn } from "cn"

const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent text-sm font-medium whitespace-nowrap select-none touch-manipulation",
    // Properties are listed so the press scale animates without delaying colors.
    "transition-[background-color,border-color,color,box-shadow,scale,opacity] duration-150 ease-out motion-reduce:transition-none",
    // Press: a small push-in. Menu triggers keep their size while open.
    "active:not-aria-[haspopup]:scale-[0.98] motion-reduce:active:scale-100",
    // Focus: an offset outline stays visible on every surface and never shifts layout.
    "outline-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:outline-destructive",
    // Loading never changes the width: the label and icons keep their space
    // and the spinner is laid over them. Hover and press are ignored while it runs.
    "data-loading:pointer-events-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-key hover:bg-brand-hover active:bg-brand-press active:shadow-key-pressed",
        outline:
          "border-border bg-surface-raised text-foreground shadow-key-soft hover:bg-surface-muted active:bg-edge-default active:shadow-key-pressed aria-expanded:bg-surface-muted",
        secondary:
          "bg-secondary text-secondary-foreground shadow-key-soft hover:bg-edge-default active:bg-edge-default active:shadow-key-pressed aria-expanded:bg-edge-default",
        ghost:
          "text-foreground hover:bg-muted active:bg-edge-default aria-expanded:bg-muted",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/30 active:shadow-key-pressed focus-visible:outline-destructive",
        link: "text-brand-fg underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-8",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Lays a spinner over the label without changing the button's width, and
     * blocks further clicks while keeping keyboard focus on the button. The
     * spinner appears only if the action is still in flight after 200ms.
     */
    loading?: boolean
  }

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  focusableWhenDisabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      focusableWhenDisabled={loading || focusableWhenDisabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {/* display: contents keeps the children as the button's own flex items. */}
      <span
        className={cn(
          "contents",
          loading && "animate-[delayed-out_0s_200ms_forwards] motion-reduce:invisible"
        )}
      >
        {children}
      </span>
      {loading ? (
        <LoaderCircle
          data-slot="spinner"
          aria-hidden="true"
          strokeWidth={1.75}
          className="absolute inset-0 m-auto animate-[delayed-in_150ms_200ms_both,spin_1s_linear_infinite] motion-reduce:animate-none"
        />
      ) : null}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
