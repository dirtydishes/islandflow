export type MetricType = "counter" | "gauge" | "timing";

export type MetricTags = Record<string, string>;

export type MetricRecord = {
  name: string;
  type: MetricType;
  value: number;
  ts: number;
  service?: string;
  tags?: MetricTags;
};

export type MetricsEmitter = (record: MetricRecord) => void;

export type MetricsOptions = {
  service?: string;
  emit?: MetricsEmitter;
  now?: () => number;
};

export type Metrics = {
  count: (name: string, value?: number, tags?: MetricTags) => void;
  gauge: (name: string, value: number, tags?: MetricTags) => void;
  timing: (name: string, value: number, tags?: MetricTags) => void;
};

const noopEmit: MetricsEmitter = () => {};

export const createMetrics = ({
  service,
  emit = noopEmit,
  now = () => Date.now()
}: MetricsOptions = {}): Metrics => {
  const write = (type: MetricType, name: string, value: number, tags?: MetricTags) => {
    emit({
      name,
      type,
      value,
      tags,
      service,
      ts: now()
    });
  };

  return {
    count: (name, value = 1, tags) => write("counter", name, value, tags),
    gauge: (name, value, tags) => write("gauge", name, value, tags),
    timing: (name, value, tags) => write("timing", name, value, tags)
  };
};
