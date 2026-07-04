"use client";

import type { FlowPacket, OptionPrint, SmartFlowAlertEvent } from "@islandflow/types";
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

export const buildAlertFlowPacketPath = (packetId: string): string =>
  `/flow/packets/${encodeURIComponent(packetId)}`;

export const buildAlertOptionPrintsPath = (traceIds: readonly string[]): string => {
  const params = new URLSearchParams();
  for (const traceId of traceIds) {
    params.append("trace_id", traceId);
  }
  const query = params.toString();
  return query ? `/option-prints/by-trace?${query}` : "/option-prints/by-trace";
};

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

const uniqueNonEmpty = (items: readonly string[]): string[] =>
  Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

export const isAlertFlowPacketRef = (ref: string): boolean => ref.startsWith("flowpacket:");
export const isAlertOptionNbboRef = (ref: string): boolean => ref.startsWith("option-nbbo:");
export const isAlertOptionPrintRef = (ref: string): boolean =>
  !isAlertFlowPacketRef(ref) && !isAlertOptionNbboRef(ref);

export const getAlertFlowPacketRefs = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">
): string[] => uniqueNonEmpty(alert.evidence_refs).filter(isAlertFlowPacketRef);

export const getAlertOptionPrintRefs = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">
): string[] => uniqueNonEmpty(alert.evidence_refs).filter(isAlertOptionPrintRef);

export const resolveAlertFlowPacket = (
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">,
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
  alert: Pick<SmartFlowAlertEvent, "evidence_refs">;
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
    if (isAlertOptionNbboRef(id)) {
      return { kind: "context", id, label: "Option NBBO" };
    }
    return { kind: "unknown", id };
  });

const readErrorDetail = async (response: Response): Promise<string> => {
  const text = await response.text();
  return text || `HTTP ${response.status}`;
};

const fetchFlowPacketsById = async ({
  packetIds,
  fetcher,
  apiBaseUrl,
  signal
}: {
  packetIds: readonly string[];
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  apiBaseUrl?: string;
  signal: AbortSignal;
}): Promise<{ packets: Map<string, FlowPacket>; missing: string[] }> => {
  const packets = new Map<string, FlowPacket>();
  const missing: string[] = [];

  await Promise.all(
    packetIds.map(async (packetId) => {
      const response = await fetcher(
        buildAlertsApiUrl(buildAlertFlowPacketPath(packetId), apiBaseUrl),
        { signal }
      );
      if (response.status === 404) {
        missing.push(packetId);
        return;
      }
      if (!response.ok) {
        throw new Error(await readErrorDetail(response));
      }
      const payload = (await response.json()) as { data?: FlowPacket | null };
      if (payload.data) {
        packets.set(payload.data.id, payload.data);
        if (payload.data.trace_id) {
          packets.set(payload.data.trace_id, payload.data);
        }
      } else {
        missing.push(packetId);
      }
    })
  );

  return { packets, missing };
};

export const fetchOptionPrintsByTraceId = async ({
  traceIds,
  fetcher,
  apiBaseUrl,
  signal
}: {
  traceIds: readonly string[];
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  apiBaseUrl?: string;
  signal: AbortSignal;
}): Promise<{ prints: Map<string, OptionPrint>; missing: string[] }> => {
  const prints = new Map<string, OptionPrint>();
  if (traceIds.length === 0) {
    return { prints, missing: [] };
  }

  const response = await fetcher(
    buildAlertsApiUrl(buildAlertOptionPrintsPath(traceIds), apiBaseUrl),
    { signal }
  );
  if (response.status === 404) {
    return { prints, missing: [...traceIds] };
  }
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  const payload = (await response.json()) as { data?: OptionPrint[] };
  for (const print of payload.data ?? []) {
    if (print.trace_id) {
      prints.set(print.trace_id, print);
    }
  }

  return {
    prints,
    missing: traceIds.filter((traceId) => !prints.has(traceId))
  };
};

export const useAlertEvidenceHydration = ({
  alert,
  flowPacketById,
  optionPrintByTraceId,
  sourceOptions
}: {
  alert: SmartFlowAlertEvent | null | undefined;
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

    const packetRefs = getAlertFlowPacketRefs(alert).filter((id) => !flowPacketById?.has(id));
    const printRefs = getAlertOptionPrintRefs(alert).filter((id) => !optionPrintByTraceId?.has(id));

    if (packetRefs.length === 0 && printRefs.length === 0) {
      setHydratedPackets(new Map());
      setHydratedPrints(new Map());
      setStatus({
        traceId: alert.trace_id,
        loading: false,
        missingRefs: [],
        error: null
      });
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

    void Promise.all([
      fetchFlowPacketsById({
        packetIds: packetRefs,
        fetcher,
        apiBaseUrl: sourceOptions?.apiBaseUrl,
        signal: abort.signal
      }),
      fetchOptionPrintsByTraceId({
        traceIds: printRefs,
        fetcher,
        apiBaseUrl: sourceOptions?.apiBaseUrl,
        signal: abort.signal
      })
    ])
      .then(([packetResult, printResult]) => {
        if (abort.signal.aborted) {
          return;
        }
        setHydratedPackets(packetResult.packets);
        setHydratedPrints(printResult.prints);
        setStatus({
          traceId: alert.trace_id,
          loading: false,
          missingRefs: [...packetResult.missing, ...printResult.missing],
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
  }, [alert, flowPacketById, optionPrintByTraceId, sourceOptions]);

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
