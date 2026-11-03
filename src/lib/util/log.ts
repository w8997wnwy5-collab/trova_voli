/** Minimal structured-log sink used by isomorphic code (the server passes its redacting logger). */
export interface LogSink {
  info(msg: string, fields?: Record<string, unknown>): void;
}

export const NO_LOG: LogSink = { info: () => {} };
