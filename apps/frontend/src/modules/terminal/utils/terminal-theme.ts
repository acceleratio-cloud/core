import type { ITheme } from '@xterm/xterm';

/**
 * The xterm.js palette. The surface and text mirror the `--terminal-*`
 * tokens in app/tokens.css (xterm.js cannot read CSS variables); the ANSI
 * colors are tuned to stay legible on that surface.
 */
export const terminalTheme: ITheme = {
  background: '#101112',
  foreground: '#e4e4e6',
  cursor: '#e4e4e6',
  cursorAccent: '#101112',
  selectionBackground: '#3a3d44',
  black: '#1d1e20',
  red: '#f2777a',
  green: '#7fd49a',
  yellow: '#f0c674',
  blue: '#7cb0f5',
  magenta: '#d49ff2',
  cyan: '#6fd3d6',
  white: '#d4d4d8',
  brightBlack: '#6b6d73',
  brightRed: '#ff9799',
  brightGreen: '#9ae6b2',
  brightYellow: '#ffd88f',
  brightBlue: '#9cc6ff',
  brightMagenta: '#e2bbff',
  brightCyan: '#94e7ea',
  brightWhite: '#f4f4f5',
};

export const TERMINAL_FONT_FAMILY =
  'var(--font-code), ui-monospace, SFMono-Regular, Menlo, monospace';
