import "@xyflow/react/dist/style.css"

import { ServersCanvas } from "@/modules/servers/containers/servers-canvas"

export default function ServersPage() {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-8xl flex-1 flex-col">
      <ServersCanvas />
    </div>
  )
}
