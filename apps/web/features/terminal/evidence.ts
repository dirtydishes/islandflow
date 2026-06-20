import type {
  AlertEvent,
  FlowPacket,
  OptionPrint,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
import { PINNED_EVIDENCE_MAX_ITEMS, PINNED_EVIDENCE_TTL_MS } from "./config";
import type { PinnedEntry } from "./types";

type AlertContextBundle = {
  alert: AlertEvent | null;
  flow_packets: FlowPacket[];
  option_prints: OptionPrint[];
  missing_refs: string[];
};

const uniqueNonEmpty = (items: string[]): string[] => {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
};

export const buildAlertContextPath = (traceId: string): string =>
  `/flow/alerts/${encodeURIComponent(traceId)}/context`;

export const collectAlertContextEvidence = (
  bundle: AlertContextBundle
): {
  packets: Map<string, FlowPacket>;
  prints: Map<string, OptionPrint>;
} => {
  const packets = new Map<string, FlowPacket>();
  const prints = new Map<string, OptionPrint>();

  for (const packet of bundle.flow_packets) {
    if (packet.id) {
      packets.set(packet.id, packet);
    }
    if (packet.trace_id) {
      packets.set(packet.trace_id, packet);
    }
  }
  for (const print of bundle.option_prints) {
    if (print.trace_id) {
      prints.set(print.trace_id, print);
    }
  }

  return { packets, prints };
};

export const getAlertFlowPacketRefs = (alert: Pick<AlertEvent, "evidence_refs">): string[] => {
  return alert.evidence_refs.filter((ref) => ref.startsWith("flowpacket:"));
};

export const getSmartFlowEvidenceRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] =>
  uniqueNonEmpty([
    ...projection.refs.evidence_refs,
    ...projection.evidence.evidence_refs,
    ...projection.hypothesis.evidence_refs
  ]);

export const isSmartFlowPacketRef = (ref: string): boolean => ref.startsWith("flowpacket:");

export const getSmartFlowPacketRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] => getSmartFlowEvidenceRefs(projection).filter(isSmartFlowPacketRef);

export const getSmartFlowOptionPrintRefs = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis">
): string[] => getSmartFlowEvidenceRefs(projection).filter((ref) => !isSmartFlowPacketRef(ref));

export const getSmartFlowPinnedFlowKeys = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis"> | null
): string[] => (projection ? getSmartFlowPacketRefs(projection) : []);

export const getSmartFlowPinnedOptionKeys = (
  projection: Pick<SmartFlowExplainabilityProjection, "refs" | "evidence" | "hypothesis"> | null
): string[] => (projection ? getSmartFlowOptionPrintRefs(projection) : []);

export const resolveAlertFlowPacket = (
  alert: Pick<AlertEvent, "evidence_refs">,
  packets: Map<string, FlowPacket>
): FlowPacket | null => {
  for (const ref of getAlertFlowPacketRefs(alert)) {
    const packet = packets.get(ref);
    if (packet) {
      return packet;
    }
  }

  return null;
};

export const prunePinnedEntries = <T>(
  current: Map<string, PinnedEntry<T>>,
  activeKeys: Set<string>,
  now: number
): Map<string, PinnedEntry<T>> => {
  const surviving: Array<[string, PinnedEntry<T>]> = [];

  for (const [key, entry] of current) {
    if (activeKeys.has(key) || now - entry.updatedAt <= PINNED_EVIDENCE_TTL_MS) {
      surviving.push([key, entry]);
    }
  }

  surviving.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const trimmed = surviving.slice(0, PINNED_EVIDENCE_MAX_ITEMS);

  if (trimmed.length === current.size) {
    let unchanged = true;
    let index = 0;
    for (const entry of current) {
      const next = trimmed[index];
      if (!next || next[0] !== entry[0] || next[1] !== entry[1]) {
        unchanged = false;
        break;
      }
      index += 1;
    }

    if (unchanged) {
      return current;
    }
  }

  return new Map(trimmed);
};
