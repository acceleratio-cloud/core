'use client';

import '@xterm/xterm/css/xterm.css';

import { useEffect, useRef, useState } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { RotateCw } from 'lucide-react';

import type {
  WorkloadTerminalClientMessage,
  WorkloadTerminalServerMessage,
} from '@acceleratio/shared';
import { workloadsApi } from '@/api/workloads';
import type {
  TerminalStatus,
  TerminalTab,
} from '../providers/terminal-provider';
import { TERMINAL_FONT_FAMILY, terminalTheme } from '../utils/terminal-theme';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const notice = (term: Terminal, text: string) => {
  term.write(`\r\n${DIM}${text}${RESET}\r\n`);
};

const parseServerMessage = (
  data: string,
): WorkloadTerminalServerMessage | null => {
  try {
    const value = JSON.parse(data) as Partial<WorkloadTerminalServerMessage>;

    return value.type === 'exit' || value.type === 'error'
      ? (value as WorkloadTerminalServerMessage)
      : null;
  } catch {
    return null;
  }
};

/** True when the element is laid out (a hidden tab has no size to fit). */
const hasSize = (element: HTMLElement | null) =>
  element !== null && element.clientWidth > 0 && element.clientHeight > 0;

export type TerminalSessionProps = {
  tab: TerminalTab;
  active: boolean;
  onStatusChange: (id: string, status: TerminalStatus) => void;
};

/**
 * One shell: an xterm.js screen bridged to the instance terminal WebSocket.
 * It stays mounted while its tab is hidden, so the shell keeps running and
 * the scrollback survives tab switches. A closed session can reconnect; the
 * old output stays above the new prompt.
 */
export const TerminalSession = ({
  tab,
  active,
  onStatusChange,
}: TerminalSessionProps) => {
  const { id, projectId, workloadId, pod, status } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // The xterm.js screen, loaded on demand so the library stays out of every
  // page that never opens a terminal.
  useEffect(() => {
    let disposed = false;
    let term: Terminal | null = null;

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([{ Terminal: XTerm }, { FitAddon: Fit }]) => {
        const container = containerRef.current;

        if (disposed || !container) {
          return;
        }

        term = new XTerm({
          cursorBlink: true,
          fontFamily: TERMINAL_FONT_FAMILY,
          fontSize: 13,
          lineHeight: 1.2,
          scrollback: 5000,
          theme: terminalTheme,
          allowProposedApi: false,
        });
        const fit = new Fit();

        term.loadAddon(fit);
        term.open(container);

        if (hasSize(container)) {
          fit.fit();
        }

        termRef.current = term;
        fitRef.current = fit;
        setReady(true);
      },
    );

    return () => {
      disposed = true;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // The connection. A new generation (Reconnect) opens a fresh one.
  useEffect(() => {
    const term = termRef.current;

    if (!ready || !term) {
      return;
    }

    let ended = false;
    const encoder = new TextEncoder();
    const socket = new WebSocket(
      workloadsApi.terminalUrl(projectId, workloadId, pod, {
        cols: term.cols,
        rows: term.rows,
      }),
    );

    socket.binaryType = 'arraybuffer';
    onStatusChange(id, 'connecting');

    const sendBytes = (bytes: Uint8Array) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(bytes);
      }
    };

    const sendControl = (message: WorkloadTerminalClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const subscriptions = [
      term.onData((data) => sendBytes(encoder.encode(data))),
      term.onBinary((data) =>
        sendBytes(Uint8Array.from(data, (char) => char.charCodeAt(0))),
      ),
      term.onResize(({ cols, rows }) =>
        sendControl({ type: 'resize', cols, rows }),
      ),
    ];

    socket.onopen = () => {
      onStatusChange(id, 'connected');
      // The screen may have been fitted after the URL was built.
      sendControl({ type: 'resize', cols: term.cols, rows: term.rows });

      if (activeRef.current) {
        term.focus();
      }
    };

    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data !== 'string') {
        term.write(new Uint8Array(event.data));
        return;
      }

      const message = parseServerMessage(event.data);

      if (message?.type === 'exit') {
        ended = true;
        notice(
          term,
          message.code === null
            ? `[${message.message}]`
            : `[Process exited with code ${message.code}]`,
        );
      } else if (message?.type === 'error') {
        ended = true;
        notice(term, `[${message.message}]`);
      }
    };

    socket.onclose = () => {
      if (!ended) {
        // The browser hides the HTTP status of a refused upgrade.
        notice(
          term,
          '[Could not connect to the instance. It may have stopped or restarted.]',
        );
      }

      onStatusChange(id, 'closed');
    };

    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    };
  }, [ready, generation, id, projectId, workloadId, pod, onStatusChange]);

  // Fit the screen to the dock whenever the visible tab changes size.
  useEffect(() => {
    const container = containerRef.current;

    if (!ready || !container) {
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (hasSize(container)) {
          fitRef.current?.fit();
        }
      });
    });

    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ready]);

  // A tab that becomes visible refits (it had no size while hidden) and
  // takes the keyboard.
  useEffect(() => {
    if (!ready || !active) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (hasSize(containerRef.current)) {
        fitRef.current?.fit();
      }

      termRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [ready, active]);

  const reconnect = () => {
    termRef.current?.write(`\r\n${DIM}[Reconnecting…]${RESET}\r\n`);
    setGeneration((value) => value + 1);
  };

  return (
    <div
      role="tabpanel"
      id={`${id}-panel`}
      aria-labelledby={`${id}-tab`}
      hidden={!active}
      className="relative h-full min-h-0"
    >
      <div
        ref={containerRef}
        className="terminal-screen h-full min-h-0 py-2 pl-3"
      />
      {status === 'closed' ? (
        <button
          type="button"
          onClick={reconnect}
          className="absolute right-4 bottom-3 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-terminal-edge bg-terminal-chrome px-2.5 font-mono text-xs text-terminal-fg transition-colors hover:bg-terminal-tab-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terminal-fg"
        >
          <RotateCw aria-hidden="true" className="size-3.5" strokeWidth={2} />
          Reconnect
        </button>
      ) : null}
    </div>
  );
};
