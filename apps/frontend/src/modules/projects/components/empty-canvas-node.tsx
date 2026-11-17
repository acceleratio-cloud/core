import type { Node, NodeProps } from '@xyflow/react';
import { Import, Plus } from 'lucide-react';

import type { CreateStart } from '@/modules/workloads/containers/create-workload-dialog';
import { Button } from '@/shared/components/ui/button';

/** Without `onCreate` (a role that cannot add services) there are no actions. */
export type EmptyCanvasNode = Node<
  { onCreate?: (start: CreateStart) => void },
  'empty'
>;

/*
  An empty project drawn the way the landing draws the platform: an isometric
  plate for the project's namespace, and a dashed block where its first
  service will stand. World units: x runs right-down, y left-down, z up.
*/
const S = 15;
const P = (x: number, y: number, z: number): [number, number] => [
  (x - y) * 0.866 * S,
  (x + y) * 0.5 * S - z * S,
];
const pts = (...points: [number, number][]) =>
  points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
const line = ([x1, y1]: [number, number], [x2, y2]: [number, number]) => ({
  x1,
  y1,
  x2,
  y2,
});

/** The namespace plate. */
const PLATE = { x: 10, y: 6, z: 0.45 };
/** The first service's block, centred on the plate. */
const BLOCK = { x0: 3.5, x1: 6.5, y0: 1.5, y1: 4.5, z0: PLATE.z, z1: 2.7 };

const [minX] = P(0, PLATE.y, 0);
const [maxX] = P(PLATE.x, 0, 0);
const [, minY] = P(BLOCK.x0, BLOCK.y0, BLOCK.z1);
const [, maxY] = P(PLATE.x, PLATE.y, 0);
const PAD = 2;
const VIEW_BOX = `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`;

/** Grid lines on the plate's top face, two units apart. */
const MESH = [
  ...[2, 4, 6, 8].map((x) => line(P(x, 0, PLATE.z), P(x, PLATE.y, PLATE.z))),
  ...[2, 4].map((y) => line(P(0, y, PLATE.z), P(PLATE.x, y, PLATE.z))),
];

const { x0, x1, y0, y1, z0, z1 } = BLOCK;
/** The block's footprint on the plate. */
const FOOTPRINT = pts(
  P(x0, y0, z0),
  P(x1, y0, z0),
  P(x1, y1, z0),
  P(x0, y1, z0),
);
const BLOCK_TOP = pts(
  P(x0, y0, z1),
  P(x1, y0, z1),
  P(x1, y1, z1),
  P(x0, y1, z1),
);
/** The edges a viewer sees: three verticals and the two front base edges. */
const BLOCK_EDGES = [
  line(P(x0, y1, z0), P(x0, y1, z1)),
  line(P(x1, y1, z0), P(x1, y1, z1)),
  line(P(x1, y0, z0), P(x1, y0, z1)),
  line(P(x0, y1, z0), P(x1, y1, z0)),
  line(P(x1, y1, z0), P(x1, y0, z0)),
];

const EmptyProjectDrawing = () => (
  <svg
    viewBox={VIEW_BOX}
    aria-hidden="true"
    className="mx-auto h-auto w-56 overflow-visible"
  >
    <g strokeWidth="1" strokeLinejoin="round">
      <polygon
        className="fill-surface-panel stroke-edge-strong"
        points={pts(
          P(0, PLATE.y, PLATE.z),
          P(PLATE.x, PLATE.y, PLATE.z),
          P(PLATE.x, PLATE.y, 0),
          P(0, PLATE.y, 0),
        )}
      />
      <polygon
        className="fill-surface-canvas stroke-edge-strong"
        points={pts(
          P(PLATE.x, 0, PLATE.z),
          P(PLATE.x, PLATE.y, PLATE.z),
          P(PLATE.x, PLATE.y, 0),
          P(PLATE.x, 0, 0),
        )}
      />
      <polygon
        className="fill-surface-raised stroke-edge-strong"
        points={pts(
          P(0, 0, PLATE.z),
          P(PLATE.x, 0, PLATE.z),
          P(PLATE.x, PLATE.y, PLATE.z),
          P(0, PLATE.y, PLATE.z),
        )}
      />
    </g>

    <g strokeWidth="0.75" className="stroke-edge-default">
      {MESH.map((segment) => (
        <line key={`${segment.x1},${segment.y1}`} {...segment} />
      ))}
    </g>

    <polygon
      points={FOOTPRINT}
      strokeWidth="1"
      className="fill-brand-fg/10 stroke-brand-fg/50"
    />
    <g
      strokeWidth="1.25"
      strokeDasharray="4 3"
      strokeLinecap="round"
      className="stroke-brand-fg"
    >
      <polygon points={BLOCK_TOP} className="fill-brand-fg/8" />
      {BLOCK_EDGES.map((edge) => (
        <line key={`${edge.x1},${edge.y1},${edge.x2}`} {...edge} />
      ))}
    </g>
  </svg>
);

/**
 * What an empty project shows on its board, where the first service will
 * appear. A read-only role sees the drawing and a line, without actions.
 */
export const EmptyCanvasNodeCard = ({
  data: { onCreate },
}: NodeProps<EmptyCanvasNode>) => (
  <div className="w-80 cursor-default text-center">
    <EmptyProjectDrawing />

    <h2 className="mt-6 text-xl leading-tight font-medium tracking-tight text-foreground">
      {onCreate ? 'Add your first service' : 'No services yet'}
    </h2>
    <p className="mx-auto mt-2 max-w-64 text-sm leading-relaxed text-balance text-muted-foreground">
      {onCreate
        ? 'Create one from scratch or import the configuration you already have.'
        : 'Nothing has been added to this project.'}
    </p>

    {onCreate ? (
      <div className="mt-6 flex justify-center gap-2">
        <Button
          type="button"
          onClick={() => onCreate('type')}
          className="nodrag nopan"
        >
          <Plus data-icon="inline-start" aria-hidden="true" strokeWidth={2} />
          Create service
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onCreate('import')}
          className="nodrag nopan"
        >
          <Import data-icon="inline-start" aria-hidden="true" />
          Import
        </Button>
      </div>
    ) : null}
  </div>
);
