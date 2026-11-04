import '@xyflow/react/dist/style.css';

import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { getServerProject } from '@/api/projects/server';
import { ProjectView } from '@/modules/projects/containers/project-view';
import { ProjectProvider } from '@/modules/projects/providers/project-provider';

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
      <div className="flex min-h-0 flex-1 flex-col">
        <ProjectView />
      </div>
    </ProjectProvider>
  );
}
