import type { SmartFlowExplainabilityProjection } from "@islandflow/types";
import { PINNED_EVIDENCE_MAX_ITEMS, PINNED_EVIDENCE_TTL_MS } from "./config";
import type { PinnedEntry } from "./types";
export {
  buildAlertContextPath,
  collectAlertContextEvidence,
  getAlertFlowPacketRefs,
  resolveAlertFlowPacket
} from "../alerts";

const uniqueNonEmpty = (items: string[]): string[] => {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
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
