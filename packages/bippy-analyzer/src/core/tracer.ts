export interface TraceEvent {
  name: string;
  cat: string;
  ph: "X" | "C";
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args: Record<string, string | number>;
}

export interface Tracer {
  readonly events: TraceEvent[];
  span: <Result>(
    category: string,
    name: string,
    run: () => Result,
    args?: Record<string, string | number>,
  ) => Result;
}

const MICROSECONDS_PER_MILLISECOND = 1000;
const BYTES_PER_MEGABYTE = 1024 * 1024;

const getMicroseconds = (): number => Math.round(performance.now() * MICROSECONDS_PER_MILLISECOND);

export const NO_TRACER: Tracer = {
  events: [],
  span: (_category, _name, run) => run(),
};

export const createTracer = (): Tracer => {
  const events: TraceEvent[] = [];
  return {
    events,
    span: (category, name, run, args = {}) => {
      const start = getMicroseconds();
      try {
        return run();
      } finally {
        const end = getMicroseconds();
        const { heapUsed, rss } = process.memoryUsage();
        events.push(
          { name, cat: category, ph: "X", ts: start, dur: end - start, pid: 1, tid: 1, args },
          {
            name: "memory",
            cat: "memory",
            ph: "C",
            ts: end,
            pid: 1,
            tid: 1,
            args: {
              heapMegabytes: Math.round(heapUsed / BYTES_PER_MEGABYTE),
              residentMegabytes: Math.round(rss / BYTES_PER_MEGABYTE),
            },
          },
        );
      }
    },
  };
};
