import { LoaderCircle } from "lucide-react"

export const CanvasLoader = ({ label }: { label: string }) => (
  <div
    aria-busy="true"
    className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
  >
    <LoaderCircle
      aria-hidden="true"
      strokeWidth={1.75}
      className="size-5 animate-spin text-muted-foreground"
    />
    <p className="text-sm text-muted-foreground">{label}</p>
  </div>
)
