"use client";

import type { AlertEvent, FlowPacket, OptionPrint } from "@islandflow/types";
import { useEffect, useMemo, useState } from "react";

import { buildAlertsApiUrl } from "./source";
import type {
  AlertContextBundle,
  AlertContextStatus,
  AlertEvidenceHydration,
  AlertEvidenceItem,
  AlertsModuleSourceOptions
} from "./types";

const EMPTY_STATUS: AlertContextStatus = {
  traceId: null,
  loading: false,
  missingRefs: [],
  error: null
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

export const getAlertFlowPacketRefs = (alert: Pick<AlertEvent, "evidence_refs">): string[] =>
  alert.evidence_refs.filter((ref) => ref.startsWith("flowpacket:"));

export const resolveAlertFlowPacket = (
  alert: Pick<AlertEvent, "evidence_refs">,
  packets: ReadonlyMap<string, FlowPacket>
): FlowPacket | null => {
  for (const ref of getAlertFlowPacketRefs(alert)) {
    const packet = packets.get(ref);
    if (packet) {
      return packet;
    }
  }

  return null;
};

export const resolveAlertEvidence = ({
  alert,
  packets,
  prints
}: {
  alert: Pick<AlertEvent, "evidence_refs">;
  packets: ReadonlyMap<string, FlowPacket>;
  prints: ReadonlyMap<string, OptionPrint>;
}): AlertEvidenceItem[] =>
  alert.evidence_refs.map((id) => {
    const packet = packets.get(id);
    if (packet) {
      return { kind: "flow", id, packet };
    }
    const print = prints.get(id);
    if (print) {
      return { kind: "print", id, print };
    }
    return { kind: "unknown", id };
  });

export const useAlertEvidenceHydration = ({
  alert,
  flowPacketById,
  optionPrintByTraceId,
  sourceOptions
}: {
  alert: AlertEvent | null | undefined;
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  optionPrintByTraceId?: ReadonlyMap<string, OptionPrint>;
  sourceOptions?: AlertsModuleSourceOptions;
}): AlertEvidenceHydration => {
  const [hydratedPackets, setHydratedPackets] = useState<Map<string, FlowPacket>>(() => new Map());
  const [hydratedPrints, setHydratedPrints] = useState<Map<string, OptionPrint>>(() => new Map());
  const [status, setStatus] = useState<AlertContextStatus>(EMPTY_STATUS);

  useEffect(() => {
    if (!alert) {
      setHydratedPackets(new Map());
      setHydratedPrints(new Map());
      setStatus(EMPTY_STATUS);
      return;
    }

    const abort = new AbortController();
    const fetcher = sourceOptions?.fetcher ?? fetch;
    setStatus({
      traceId: alert.trace_id,
      loading: true,
      missingRefs: [],
      error: null
    });

    void fetcher(
      buildAlertsApiUrl(buildAlertContextPath(alert.trace_id), sourceOptions?.apiBaseUrl),
      {
        signal: abort.signal
      }
    )
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || `Alert context failed with HTTP ${response.status}`);
        }
        return response.json() as Promise<AlertContextBundle>;
      })
      .then((payload) => {
        if (abort.signal.aborted) {
          return;
        }
        const { packets, prints } = collectAlertContextEvidence(payload);
        setHydratedPackets(packets);
        setHydratedPrints(prints);
        setStatus({
          traceId: alert.trace_id,
          loading: false,
          missingRefs: payload.missing_refs ?? [],
          error: null
        });
      })
      .catch((error) => {
        if (abort.signal.aborted) {
          return;
        }
        setHydratedPackets(new Map());
        setHydratedPrints(new Map());
        setStatus({
          traceId: alert.trace_id,
          loading: false,
          missingRefs: [],
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => abort.abort();
  }, [alert, sourceOptions]);

  const packets = useMemo(() => {
    const next = new Map<string, FlowPacket>();
    for (const [key, value] of flowPacketById ?? []) {
      next.set(key, value);
    }
    for (const [key, value] of hydratedPackets) {
      next.set(key, value);
    }
    return next;
  }, [flowPacketById, hydratedPackets]);

  const prints = useMemo(() => {
    const next = new Map<string, OptionPrint>();
    for (const [key, value] of optionPrintByTraceId ?? []) {
      next.set(key, value);
    }
    for (const [key, value] of hydratedPrints) {
      next.set(key, value);
    }
    return next;
  }, [hydratedPrints, optionPrintByTraceId]);

  return useMemo(() => {
    if (!alert) {
      return {
        evidence: [],
        flowPacket: null,
        status
      };
    }

    return {
      evidence: resolveAlertEvidence({ alert, packets, prints }),
      flowPacket: resolveAlertFlowPacket(alert, packets),
      status
    };
  }, [alert, packets, prints, status]);
};
