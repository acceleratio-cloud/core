import '@xyflow/react/dist/style.css';

import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { getServerProject } from '@/api/projects/server';
import { ProjectView } from '@/modules/projects/containers/project-view';
import { ProjectProvider } from '@/modules/projects/providers/project-provider';
import { TerminalDock } from '@/modules/terminal/containers/terminal-dock';
import { TerminalProvider } from '@/modules/terminal/providers/terminal-provider';

export default async function ProjectPage({
  params,
}: PageProps<'/project/[id]'>) {
  await connection();

  const { id } = await params;
  const project = await getServerProject(id);

  if (!project) {
    notFound();
  }

  return (
    <ProjectProvider key={project.id} project={project}>
      {/* Terminals belong to the project: they exist only on this page and
          end when the user leaves it or switches projects. The dock is a
          sibling of the view, so it shrinks the view rather than covering it. */}
      <TerminalProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <ProjectView />
          <TerminalDock />
        </div>
      </TerminalProvider>
    </ProjectProvider>
  );
}
