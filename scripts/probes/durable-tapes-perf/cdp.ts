import type { CdpMetricSnapshot, CdpPayload } from "./types";

export class CdpClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      method: string;
    }
  >();
  private handlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out connecting to CDP WebSocket.")),
        10_000
      );
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket connection failed."));
      });
    });

    ws.addEventListener("message", (event) => {
      const data =
        typeof event.data === "string"
          ? event.data
          : Buffer.from(event.data as ArrayBuffer).toString("utf8");
      const message = JSON.parse(data) as CdpPayload;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(`${pending.method}: ${message.error.message ?? "CDP error"}`));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }
      if (message.method) {
        const handlers = this.handlers.get(message.method) ?? [];
        for (const handler of handlers) {
          handler(message.params);
        }
      }
    });
  }

  on(method: string, handler: (params: unknown) => void): void {
    const current = this.handlers.get(method) ?? [];
    current.push(handler);
    this.handlers.set(method, current);
  }

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP WebSocket is not open."));
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params: params ?? {} };
    this.ws.send(JSON.stringify(payload));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        method
      });
    });
  }

  close(): void {
    this.ws?.close();
  }
}

export const getPerformanceSnapshot = async (client: CdpClient): Promise<CdpMetricSnapshot> => {
  const result = await client.send<{ metrics: Array<{ name: string; value: number }> }>(
    "Performance.getMetrics"
  );
  const metrics = new Map(result.metrics.map((metric) => [metric.name, metric.value]));
  return {
    taskDurationSeconds: metrics.get("TaskDuration") ?? null,
    scriptDurationSeconds: metrics.get("ScriptDuration") ?? null,
    jsHeapUsedSizeBytes: metrics.get("JSHeapUsedSize") ?? null,
    domNodeCount: metrics.get("Nodes") ?? null
  };
};

export const diffMetric = (start: number | null, end: number | null): number | null =>
  start === null || end === null ? null : end - start;
