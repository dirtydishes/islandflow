import type {
  EquityPrintJoin,
  FlowPacket,
  InferredDarkEvent,
  OptionPrint
} from "@islandflow/types";

import type { PinnedEntry } from "./types";

export const normalizeContractId = (value: string): string => value.trim();

export const extractUnderlying = (contractId: string): string => {
  const match = contractId.match(/^(.+)-\d{4}-\d{2}-\d{2}-/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return contractId.split("-")[0]?.toUpperCase() ?? contractId.toUpperCase();
};

export const normalizeJoinRefCandidates = (value: string): string[] => {
  const ref = value.trim();
  if (!ref) {
    return [];
  }

  if (ref.startsWith("equityjoin:")) {
    const rawTrace = ref.slice("equityjoin:".length);
    return rawTrace ? [ref, rawTrace] : [ref];
  }

  return [ref, `equityjoin:${ref}`];
};

export const resolveJoinFromRef = (
  ref: string,
  joins: Map<string, EquityPrintJoin>
): EquityPrintJoin | null => {
  const candidates = normalizeJoinRefCandidates(ref);
  for (const key of candidates) {
    const match = joins.get(key);
    if (match) {
      return match;
    }
  }
  return null;
};

export const formatDarkTrace = (traceId: string): string => {
  const normalized = traceId.trim();
  if (!normalized) {
    return "unknown";
  }

  if (normalized.startsWith("equityjoin:")) {
    return normalized.slice("equityjoin:".length);
  }

  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 2) {
    return normalized;
  }

  const kind = parts[1]?.replace(/_/g, " ") ?? "event";
  const remainder = parts.slice(2).join(" -> ");
  if (!remainder) {
    return kind;
  }
  return `${kind}: ${remainder}`;
};

export const inferDarkUnderlying = (
  event: InferredDarkEvent,
  equityJoins: Map<string, EquityPrintJoin>
): string | null => {
  for (const ref of event.evidence_refs) {
    const join = resolveJoinFromRef(ref, equityJoins);
    if (!join) {
      continue;
    }
    const underlying = join.features.underlying_id;
    if (typeof underlying === "string" && underlying.length > 0) {
      return underlying.toUpperCase();
    }
  }

  const match = event.trace_id.match(/^dark:(?:stealth_accumulation|distribution):([^:]+):/);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return null;
};

export const EMPTY_PACKET_ID_BY_OPTION_TRACE_ID = new Map<string, string>();

export const upsertPinnedEntries = <T>(
  current: Map<string, PinnedEntry<T>>,
  incoming: Map<string, T>,
  now: number
): Map<string, PinnedEntry<T>> => {
  const next = new Map(current);
  for (const [key, value] of incoming) {
    next.set(key, { value, updatedAt: now });
  }
  return next;
};

export type EvidenceItem =
  | { kind: "flow"; id: string; packet: FlowPacket }
  | { kind: "print"; id: string; print: OptionPrint }
  | { kind: "unknown"; id: string };

export type DarkEvidenceItem =
  | { kind: "join"; id: string; join: EquityPrintJoin }
  | { kind: "unknown"; id: string };
