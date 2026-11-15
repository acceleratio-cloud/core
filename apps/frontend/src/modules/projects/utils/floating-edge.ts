import { Position } from '@xyflow/react';

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the line from the centre of `node` towards the centre of `other`
 * leaves the border of `node`, and which side that is. Edges between freely
 * placed cards attach to the sides that face each other.
 */
export const borderPoint = (node: Rect, other: Rect) => {
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const centerX = node.x + halfWidth;
  const centerY = node.y + halfHeight;
  const dx = other.x + other.width / 2 - centerX;
  const dy = other.y + other.height / 2 - centerY;
  const across = Math.abs(dx) / halfWidth;
  const along = Math.abs(dy) / halfHeight;

  if (across === 0 && along === 0) {
    return { x: centerX, y: centerY, position: Position.Top };
  }

  const scale = 1 / Math.max(across, along);
  const position =
    across >= along
      ? dx > 0
        ? Position.Right
        : Position.Left
      : dy > 0
        ? Position.Bottom
        : Position.Top;

  return { x: centerX + dx * scale, y: centerY + dy * scale, position };
};
