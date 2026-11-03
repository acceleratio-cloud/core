import { Plus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

const serverRows = [
  { y: 92.5, name: 32, meta: 22 },
  { y: 106.5, name: 44, meta: 14 },
  { y: 120.5, name: 26, meta: 20 },
];

const ProjectsEmptyIllustration = () => {
  return (
    <svg
      viewBox="56 18 152 130"
      fill="none"
      strokeWidth="1"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-auto w-48 shrink-0"
    >
      {/* The cards this page will collect, stacked behind the first one. */}
      <rect
        x="64"
        y="26"
        width="136"
        height="96"
        rx="10"
        className="fill-background stroke-muted-foreground/20"
      />
      <rect
        x="64"
        y="38"
        width="136"
        height="96"
        rx="10"
        className="fill-background stroke-muted-foreground/30"
      />

      {/* The first project, holding its servers. */}
      <rect
        x="64"
        y="44"
        width="136"
        height="96"
        rx="10"
        className="fill-background stroke-muted-foreground/45"
      />

      {/* Project header: glyph and name. */}
      <rect
        x="76"
        y="56"
        width="18"
        height="18"
        rx="4.5"
        className="stroke-muted-foreground/45"
      />
      <rect
        x="81"
        y="61"
        width="8"
        height="8"
        rx="1.5"
        className="stroke-muted-foreground/50"
      />
      <path d="M81 65H89" className="stroke-muted-foreground/50" />
      <rect
        x="101"
        y="61.5"
        width="46"
        height="5"
        rx="2.5"
        className="fill-muted-foreground/55"
      />
      <rect
        x="101"
        y="70"
        width="26"
        height="3.5"
        rx="1.75"
        className="fill-muted-foreground/25"
      />
      <path
        d="M182 67L188 61M188 61H183.5M188 61V65.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-muted-foreground/45"
      />

      {/* Rule between the header and the server list. */}
      <path d="M76 85H188" className="stroke-muted-foreground/25" />

      {serverRows.map((row) => (
        <g key={row.y}>
          <rect
            x="76.5"
            y={row.y}
            width="111"
            height="7"
            rx="2.5"
            className="stroke-muted-foreground/30"
          />
          <rect
            x="81.5"
            y={row.y + 2}
            width="3"
            height="3"
            rx="0.75"
            className="fill-muted-foreground/60"
          />
          <rect
            x="89"
            y={row.y + 2.25}
            width={row.name}
            height="2.5"
            rx="1.25"
            className="fill-muted-foreground/35"
          />
          <rect
            x={182 - row.meta}
            y={row.y + 2.25}
            width={row.meta}
            height="2.5"
            rx="1.25"
            className="fill-muted-foreground/20"
          />
        </g>
      ))}
    </svg>
  );
};

export const ProjectsEmptyState = ({ onCreate }: { onCreate: () => void }) => {
  return (
    <div className="mt-6 flex min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-surface-raised px-6 py-14 text-center">
      <ProjectsEmptyIllustration />

      <h2 className="mt-2 text-sm font-medium text-foreground">
        No projects yet
      </h2>
      <p className="mt-2 max-w-[19rem] text-sm text-balance text-muted-foreground">
        Create a project to group the servers and infrastructure you operate.
      </p>

      <Button variant="outline" onClick={onCreate} className="mt-6">
        <Plus data-icon="inline-start" aria-hidden="true" strokeWidth={2} />
        New project
      </Button>
    </div>
  );
};
