/**
 * Control frames of the instance terminal WebSocket
 * (`/projects/:projectId/workloads/:id/instances/:pod/terminal`). Terminal
 * bytes travel as binary frames both ways; these JSON objects travel as text
 * frames.
 */

/** Browser → API: the terminal was resized. */
export interface WorkloadTerminalResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

/** API → browser: the shell ended; the socket closes right after. */
export interface WorkloadTerminalExitMessage {
  type: "exit";
  /** Null when Kubernetes reported no exit code. */
  code: number | null;
  message: string;
}

/** API → browser: the session could not start or broke; the socket closes. */
export interface WorkloadTerminalErrorMessage {
  type: "error";
  message: string;
}

export type WorkloadTerminalClientMessage = WorkloadTerminalResizeMessage;

export type WorkloadTerminalServerMessage =
  | WorkloadTerminalExitMessage
  | WorkloadTerminalErrorMessage;
