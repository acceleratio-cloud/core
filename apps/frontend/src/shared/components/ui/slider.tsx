"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

/** A single-value slider. Pass `aria-label` or label it through `Field`. */
function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  "aria-label"?: string
  "aria-labelledby"?: string
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex h-5 w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            className="block size-4 rounded-full border border-primary bg-surface-raised shadow-sm transition-[box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
