import { ProjectsView } from "@/modules/projects/containers/projects-view"
import { SystemStatus } from "@/modules/system/containers/system-status"

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <ProjectsView />
      <SystemStatus />
    </div>
  )
}
