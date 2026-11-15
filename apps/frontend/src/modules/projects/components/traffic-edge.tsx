'use client';

import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

import { borderPoint, type Rect } from '../utils/floating-edge';

export type TrafficEdgeData = {
  flowsPerSecond: number;
  /** Both services open connections: dots travel both ways. */
  twoWay: boolean;
  /** Dots stand still instead of travelling. */
  reducedMotion: boolean;
  /** Hover text, e.g. "api → db · 3.2 flows/s". */
  label: string;
};

export type TrafficEdge = Edge<TrafficEdgeData, 'traffic'>;

/** Seconds a dot takes from client to server; load shows in the dot count. */
const DOT_TRAVEL_SECONDS = 2.4;
const MAX_DOTS = 6;

/** Dots on a link: none when quiet, then one more per doubling of flows. */
export const dotCount = (flowsPerSecond: number): number =>
  flowsPerSecond <= 0
    ? 0
    : Math.min(MAX_DOTS, Math.max(1, Math.ceil(Math.log2(1 + flowsPerSecond))));

const rectOf = (node: InternalNode): Rect | null => {
  const { width, height } = node.measured;

  return width && height
    ? { ...node.internals.positionAbsolute, width, height }
    : null;
};

/**
 * A link between two services that talk to each other: a wide muted pipe
 * from client to server, with blue dots travelling along it as many as the
 * current traffic warrants, both ways on a two-way link. With reduced motion
 * the dots stand still.
 */
export const TrafficEdge = ({
  id,
  source,
  target,
  data,
}: EdgeProps<TrafficEdge>) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const sourceRect = sourceNode ? rectOf(sourceNode) : null;
  const targetRect = targetNode ? rectOf(targetNode) : null;

  if (!sourceRect || !targetRect) {
    return null;
  }

  const from = borderPoint(sourceRect, targetRect);
  const to = borderPoint(targetRect, sourceRect);
  const [path] = getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: from.position,
    targetX: to.x,
    targetY: to.y,
    targetPosition: to.position,
  });
  const count = dotCount(data?.flowsPerSecond ?? 0);
  // A busy two-way link needs a dot each way to show it.
  const dots = data?.twoWay && count === 1 ? 2 : count;

  return (
    <g>
      <title>{data?.label}</title>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke: 'var(--edge-strong)',
          strokeOpacity: 0.35,
          strokeWidth: 6,
          strokeLinecap: 'round',
        }}
      />
      {Array.from({ length: dots }, (_, index) => {
        const offset = index / dots;
        // On a two-way link every other dot runs from server to client.
        const backwards = data?.twoWay === true && index % 2 === 1;

        return (
          <circle key={index} r={3} fill="var(--brand-fg)" aria-hidden="true">
            {data?.reducedMotion ? (
              <animateMotion
                path={path}
                dur="1s"
                fill="freeze"
                calcMode="linear"
                keyPoints={`${offset + 0.5 / dots};${offset + 0.5 / dots}`}
                keyTimes="0;1"
              />
            ) : (
              <animateMotion
                path={path}
                dur={`${DOT_TRAVEL_SECONDS}s`}
                begin={`${-offset * DOT_TRAVEL_SECONDS}s`}
                repeatCount="indefinite"
                calcMode="linear"
                keyPoints={backwards ? '1;0' : '0;1'}
                keyTimes="0;1"
              />
            )}
          </circle>
        );
      })}
    </g>
  );
};
