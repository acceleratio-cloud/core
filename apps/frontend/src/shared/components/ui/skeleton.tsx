import { cn } from "cn"

/**
 * A still placeholder. It stays invisible for its first 200ms, so data that
 * arrives at once never flashes a skeleton, and it does not pulse.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-[delayed-in_150ms_200ms_both] rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
