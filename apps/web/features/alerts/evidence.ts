"use client";

import {
  SMART_FLOW_ALERT_EVIDENCE_LOOKUP_PATH,
  SmartFlowAlertEvidenceBundleSchema,
  type FlowPacket,
  type OptionPrint,
  type SmartFlowAlertEvent
} from "@islandflow/types";
import { useEffect, useMemo, useState } from "react";

import { buildAlertsApiUrl } from "./source";
import { isAlertFlowPacketRef, isAlertOptionPrintRef } from "./refs";
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

export const buildAlertEvidenceLookupPath = (): string => SMART_FLOW_ALERT_EVIDENCE_LOOKUP_PATH;

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
      return { kind: "flow_packet", ref: id, packet };
    }
    const print = prints.get(id);
    if (print) {
      return { kind: "option_print", ref: id, print };
    }
    return { kind: "unresolved", ref: id, inferred_kind: "unknown", reason: "not_found" };
  });

const readErrorDetail = async (response: Response): Promise<string> => {
  const text = await response.text();
  return text || `HTTP ${response.status}`;
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

export const fetchAlertEvidenceBundle = async ({
  alertId,
  refs,
  fetcher,
  apiBaseUrl,
  signal
}: {
  alertId?: string;
  refs: readonly string[];
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  apiBaseUrl?: string;
  signal: AbortSignal;
}) => {
  const response = await fetcher(buildAlertsApiUrl(buildAlertEvidenceLookupPath(), apiBaseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ alert_id: alertId, refs }),
    signal
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  return SmartFlowAlertEvidenceBundleSchema.parse(await response.json());
};

export const useAlertEvidenceHydration = ({
  alert,
  sourceOptions
}: {
  alert: SmartFlowAlertEvent | null | undefined;
  flowPacketById?: ReadonlyMap<string, FlowPacket>;
  optionPrintByTraceId?: ReadonlyMap<string, OptionPrint>;
  sourceOptions?: AlertsModuleSourceOptions;
}): AlertEvidenceHydration => {
  const [bundle, setBundle] = useState<AlertEvidenceHydration["bundle"]>(null);
  const [status, setStatus] = useState<AlertContextStatus>(EMPTY_STATUS);

  useEffect(() => {
    if (!alert) {
      setBundle(null);
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

    void fetchAlertEvidenceBundle({
      alertId: alert.alert_id,
      refs: alert.evidence_refs,
      fetcher,
      apiBaseUrl: sourceOptions?.apiBaseUrl,
      signal: abort.signal
    })
      .then((nextBundle) => {
        if (abort.signal.aborted) {
          return;
        }
        setBundle(nextBundle);
        setStatus({
          traceId: alert.trace_id,
          loading: false,
          missingRefs: nextBundle.items
            .filter((item) => item.kind === "unresolved")
            .map((item) => item.ref),
          error: null
        });
      })
      .catch((error) => {
        if (abort.signal.aborted) {
          return;
        }
        setBundle(null);
        setStatus({
          traceId: alert.trace_id,
          loading: false,
          missingRefs: [],
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return () => abort.abort();
  }, [alert, sourceOptions]);

  return useMemo(() => {
    if (!alert) {
      return {
        evidence: [],
        bundle: null,
        flowPacket: null,
        status
      };
    }

    const evidence = bundle?.items ?? [];
    const flowPacket = evidence.find((item) => item.kind === "flow_packet")?.packet ?? null;
    return {
      evidence,
      bundle,
      flowPacket,
      status
    };
  }, [alert, bundle, status]);
};
