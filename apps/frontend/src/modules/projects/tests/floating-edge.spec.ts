import { describe, expect, it } from 'bun:test';
import { Position } from '@xyflow/react';

import { borderPoint } from '../utils/floating-edge';

const card = (x: number, y: number) => ({ x, y, width: 200, height: 100 });

describe('borderPoint', () => {
  it('leaves through the side that faces the other card', () => {
    expect(borderPoint(card(0, 0), card(500, 0))).toEqual({
      x: 200,
      y: 50,
      position: Position.Right,
    });
    expect(borderPoint(card(0, 0), card(0, -400))).toEqual({
      x: 100,
      y: 0,
      position: Position.Top,
    });
  });

  it('stays on the border for a diagonal', () => {
    const point = borderPoint(card(0, 0), card(400, 400));

    expect(point).toEqual({ x: 150, y: 100, position: Position.Bottom });
  });

  it('falls back to the centre when the cards overlap exactly', () => {
    expect(borderPoint(card(0, 0), card(0, 0))).toEqual({
      x: 100,
      y: 50,
      position: Position.Top,
    });
  });
});
