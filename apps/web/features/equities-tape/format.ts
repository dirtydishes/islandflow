import type { EquityPrint } from "@islandflow/types";
import { formatEasternTime, formatEasternTimestampWithMs } from "../time-format";

export const getEquityPrintKey = (print: EquityPrint): string =>
  print.trace_id || `${print.ts}:${print.seq}:${print.underlying_id}`;

export const getEquityPrintCursor = (print: EquityPrint): { ts: number; seq: number } => ({
  ts: print.ts,
  seq: print.seq
});

export const getEquityPrintNotional = (print: EquityPrint): number => print.price * print.size;

export const formatEquityTapeTime = (ts: number): string => {
  return formatEasternTime(ts, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

export const formatEquityTapeTimestamp = (ts: number): string => {
  return formatEasternTimestampWithMs(ts, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

export const formatEquityTapePrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export const formatEquityTapeSize = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.round(value).toLocaleString();
};

export const formatEquityTapeNotional = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 1
    })}m`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString(undefined, {
      maximumFractionDigits: 0
    })}k`;
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
};
