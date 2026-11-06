import type { PlatformComponent } from '@acceleratio/shared';
import { CopyButton } from '@/shared/components/copy-button';

type PlatformComponentsListProps = {
  components: PlatformComponent[];
};

type Group = { label: string; components: PlatformComponent[] };

/** Acceleratio itself, the cluster it runs on, then its data store. */
const groupComponents = (components: PlatformComponent[]): Group[] => {
  const groups: Group[] = [
    { label: 'Acceleratio', components: [] },
    { label: 'Cluster', components: [] },
    { label: 'Data', components: [] },
  ];

  for (const component of components) {
    if (component.id === 'api' || component.id === 'console') {
      groups[0].components.push(component);
    } else if (component.id === 'postgres') {
      groups[2].components.push(component);
    } else {
      groups[1].components.push(component);
    }
  }

  return groups.filter((group) => group.components.length > 0);
};

/** What the installation runs: each component, its version and its source. */
export const PlatformComponentsList = ({
  components,
}: PlatformComponentsListProps) => (
  <div className="overflow-hidden rounded-md border border-border">
    <table className="w-full table-fixed text-[13px]">
      <caption className="sr-only">Installed components</caption>
      <thead className="bg-surface-sunken text-left text-[12px] text-muted-foreground">
        <tr>
          <th scope="col" className="w-[38%] px-4 py-2 font-medium">
            Component
          </th>
          <th scope="col" className="w-[22%] px-4 py-2 font-medium">
            Version
          </th>
          <th
            scope="col"
            className="hidden px-4 py-2 font-medium sm:table-cell"
          >
            Source
          </th>
        </tr>
      </thead>
      {groupComponents(components).map((group) => (
        <tbody key={group.label} className="border-t border-border">
          <tr>
            <th
              scope="rowgroup"
              colSpan={3}
              className="px-4 pt-3 pb-1 text-left text-[12px] font-medium text-fg-tertiary"
            >
              {group.label}
            </th>
          </tr>
          {group.components.map((component) => (
            <tr key={component.id} className="group hover:bg-surface-sunken">
              <th
                scope="row"
                className="truncate px-4 py-2 text-left font-normal text-foreground"
              >
                {component.name}
              </th>
              <td className="truncate px-4 py-2 font-mono text-foreground tabular-nums">
                {component.version ?? (
                  <span className="font-sans text-muted-foreground">
                    Unknown
                  </span>
                )}
              </td>
              <td className="hidden px-4 py-1.5 sm:table-cell">
                {component.detail ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span
                      className="truncate font-mono text-muted-foreground"
                      title={component.detail}
                    >
                      {component.detail}
                    </span>
                    <CopyButton
                      value={component.detail}
                      label={`${component.name} source`}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    />
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  </div>
);
