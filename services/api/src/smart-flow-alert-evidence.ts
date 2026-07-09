import type {
  ClickHouseClient,
  EquityQuoteExactLookup,
  OptionNbboExactLookup
} from "@islandflow/storage";
import {
  fetchEquityPrintsByTraceIds,
  fetchEquityQuotesByUnderlyingAndTs,
  fetchFlowPacketsByIds,
  fetchOptionNBBOByContractAndTs,
  fetchOptionPrintsByTraceIds
} from "@islandflow/storage";
import {
  SmartFlowAlertEvidenceBundleSchema,
  type SmartFlowAlertEvidenceBundle,
  type SmartFlowAlertEvidenceInferredKind,
  type SmartFlowAlertEvidenceItem,
  type SmartFlowAlertEvidenceLookupRequest,
  type SmartFlowExternalContextPayload
} from "@islandflow/types";

type ParsedEvidenceRef =
  | { kind: "flow_packet"; ref: string; id: string }
  | { kind: "option_print"; ref: string; traceId: string }
  | { kind: "option_nbbo"; ref: string; lookup: OptionNbboExactLookup }
  | { kind: "equity_quote"; ref: string; lookup: EquityQuoteExactLookup }
  | { kind: "equity_print"; ref: string; traceId: string }
  | { kind: "synthetic_label"; ref: string; labelType: string; labelId: string; context: string[] }
  | { kind: "external_context"; ref: string; context: SmartFlowExternalContextPayload }
  | {
      kind: "unresolved";
      ref: string;
      inferredKind: SmartFlowAlertEvidenceInferredKind;
      reason: "malformed_ref" | "unsupported_ref";
    };

export type SmartFlowAlertEvidenceResolverDeps = {
  fetchFlowPacketsByIds: typeof fetchFlowPacketsByIds;
  fetchOptionPrintsByTraceIds: typeof fetchOptionPrintsByTraceIds;
  fetchOptionNBBOByContractAndTs: typeof fetchOptionNBBOByContractAndTs;
  fetchEquityQuotesByUnderlyingAndTs: typeof fetchEquityQuotesByUnderlyingAndTs;
  fetchEquityPrintsByTraceIds: typeof fetchEquityPrintsByTraceIds;
};

const DEFAULT_DEPS: SmartFlowAlertEvidenceResolverDeps = {
  fetchFlowPacketsByIds,
  fetchOptionPrintsByTraceIds,
  fetchOptionNBBOByContractAndTs,
  fetchEquityQuotesByUnderlyingAndTs,
  fetchEquityPrintsByTraceIds
};

const EXTERNAL_CONTEXT_PREFIXES = ["external-context:", "news-story:", "event-calendar:"] as const;

const unique = <T>(items: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const values: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(item);
  }
  return values;
};

const unresolved = (
  ref: string,
  inferredKind: SmartFlowAlertEvidenceInferredKind,
  reason: "malformed_ref" | "not_found" | "unsupported_ref"
): SmartFlowAlertEvidenceItem => ({
  kind: "unresolved",
  ref,
  inferred_kind: inferredKind,
  reason
});

const parseLastColonLookup = (
  ref: string,
  prefix: "option-nbbo:" | "equity-quote:"
): { left: string; ts: number } | null => {
  const body = ref.slice(prefix.length);
  const separator = body.lastIndexOf(":");
  if (separator <= 0 || separator === body.length - 1) {
    return null;
  }

  const left = body.slice(0, separator).trim();
  const ts = Number(body.slice(separator + 1));
  if (!left || !Number.isInteger(ts) || ts < 0) {
    return null;
  }

  return { left, ts };
};

const parseSyntheticLabel = (ref: string): ParsedEvidenceRef => {
  const body = ref.slice("synthetic-label:".length);
  const parts = body
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return {
      kind: "unresolved",
      ref,
      inferredKind: "synthetic_label",
      reason: "malformed_ref"
    };
  }

  return {
    kind: "synthetic_label",
    ref,
    labelType: parts[0] ?? "",
    labelId: parts.slice(1).join(":"),
    context: parts.slice(1)
  };
};

const parseExternalContext = (ref: string): ParsedEvidenceRef | null => {
  for (const prefix of EXTERNAL_CONTEXT_PREFIXES) {
    if (!ref.startsWith(prefix)) {
      continue;
    }
    const id = ref.slice(prefix.length).trim();
    const source = prefix.slice(0, -1) as SmartFlowExternalContextPayload["source"];
    if (!id) {
      return {
        kind: "unresolved",
        ref,
        inferredKind: "external_context",
        reason: "malformed_ref"
      };
    }
    return {
      kind: "external_context",
      ref,
      context: { source, id }
    };
  }
  return null;
};

export const parseSmartFlowAlertEvidenceRef = (rawRef: string): ParsedEvidenceRef => {
  const ref = rawRef.trim();
  if (ref.startsWith("flowpacket:")) {
    return ref.length > "flowpacket:".length
      ? { kind: "flow_packet", ref, id: ref }
      : { kind: "unresolved", ref, inferredKind: "flow_packet", reason: "malformed_ref" };
  }

  if (ref.startsWith("option-nbbo:")) {
    const parsed = parseLastColonLookup(ref, "option-nbbo:");
    return parsed
      ? {
          kind: "option_nbbo",
          ref,
          lookup: { option_contract_id: parsed.left, ts: parsed.ts }
        }
      : { kind: "unresolved", ref, inferredKind: "option_nbbo", reason: "malformed_ref" };
  }

  if (ref.startsWith("equity-quote:")) {
    const parsed = parseLastColonLookup(ref, "equity-quote:");
    return parsed
      ? {
          kind: "equity_quote",
          ref,
          lookup: { underlying_id: parsed.left, ts: parsed.ts }
        }
      : { kind: "unresolved", ref, inferredKind: "equity_quote", reason: "malformed_ref" };
  }

  if (ref.startsWith("equity-print:")) {
    const traceId = ref.slice("equity-print:".length).trim();
    return traceId
      ? { kind: "equity_print", ref, traceId }
      : { kind: "unresolved", ref, inferredKind: "equity_print", reason: "malformed_ref" };
  }

  if (ref.startsWith("synthetic-label:")) {
    return parseSyntheticLabel(ref);
  }

  const externalContext = parseExternalContext(ref);
  if (externalContext) {
    return externalContext;
  }

  if (ref.includes(":") && !ref.startsWith("print:")) {
    return { kind: "unresolved", ref, inferredKind: "unknown", reason: "unsupported_ref" };
  }

  return { kind: "option_print", ref, traceId: ref };
};

const exactLookupKey = (left: string, ts: number): string => `${left}\u0000${ts}`;

export const resolveSmartFlowAlertEvidenceBundle = async (
  client: ClickHouseClient,
  request: SmartFlowAlertEvidenceLookupRequest,
  deps: SmartFlowAlertEvidenceResolverDeps = DEFAULT_DEPS
): Promise<SmartFlowAlertEvidenceBundle> => {
  const parsedRefs = request.refs.map(parseSmartFlowAlertEvidenceRef);

  const [flowPackets, optionPrints, optionNbbos, equityQuotes, equityPrints] = await Promise.all([
    deps.fetchFlowPacketsByIds(
      client,
      unique(
        parsedRefs.filter(
          (ref): ref is Extract<ParsedEvidenceRef, { kind: "flow_packet" }> =>
            ref.kind === "flow_packet"
        ),
        (ref) => ref.id
      ).map((ref) => ref.id)
    ),
    deps.fetchOptionPrintsByTraceIds(
      client,
      unique(
        parsedRefs.filter(
          (ref): ref is Extract<ParsedEvidenceRef, { kind: "option_print" }> =>
            ref.kind === "option_print"
        ),
        (ref) => ref.traceId
      ).map((ref) => ref.traceId)
    ),
    deps.fetchOptionNBBOByContractAndTs(
      client,
      unique(
        parsedRefs.filter(
          (ref): ref is Extract<ParsedEvidenceRef, { kind: "option_nbbo" }> =>
            ref.kind === "option_nbbo"
        ),
        (ref) => exactLookupKey(ref.lookup.option_contract_id, ref.lookup.ts)
      ).map((ref) => ref.lookup)
    ),
    deps.fetchEquityQuotesByUnderlyingAndTs(
      client,
      unique(
        parsedRefs.filter(
          (ref): ref is Extract<ParsedEvidenceRef, { kind: "equity_quote" }> =>
            ref.kind === "equity_quote"
        ),
        (ref) => exactLookupKey(ref.lookup.underlying_id.toUpperCase(), ref.lookup.ts)
      ).map((ref) => ref.lookup)
    ),
    deps.fetchEquityPrintsByTraceIds(
      client,
      unique(
        parsedRefs.filter(
          (ref): ref is Extract<ParsedEvidenceRef, { kind: "equity_print" }> =>
            ref.kind === "equity_print"
        ),
        (ref) => ref.traceId
      ).map((ref) => ref.traceId)
    )
  ]);

  const flowPacketById = new Map(flowPackets.flatMap((packet) => [[packet.id, packet]] as const));
  const optionPrintByTraceId = new Map(optionPrints.map((print) => [print.trace_id, print]));
  const optionNbboByKey = new Map(
    optionNbbos.map((nbbo) => [exactLookupKey(nbbo.option_contract_id, nbbo.ts), nbbo])
  );
  const equityQuoteByKey = new Map(
    equityQuotes.map((quote) => [
      exactLookupKey(quote.underlying_id.toUpperCase(), quote.ts),
      quote
    ])
  );
  const equityPrintByTraceId = new Map(equityPrints.map((print) => [print.trace_id, print]));

  const items = parsedRefs.map((parsed): SmartFlowAlertEvidenceItem => {
    switch (parsed.kind) {
      case "flow_packet": {
        const packet = flowPacketById.get(parsed.id);
        return packet
          ? { kind: "flow_packet", ref: parsed.ref, packet }
          : unresolved(parsed.ref, "flow_packet", "not_found");
      }
      case "option_print": {
        const print = optionPrintByTraceId.get(parsed.traceId);
        return print
          ? { kind: "option_print", ref: parsed.ref, print }
          : unresolved(parsed.ref, "option_print", "not_found");
      }
      case "option_nbbo": {
        const nbbo = optionNbboByKey.get(
          exactLookupKey(parsed.lookup.option_contract_id, parsed.lookup.ts)
        );
        return nbbo
          ? { kind: "option_nbbo", ref: parsed.ref, nbbo }
          : unresolved(parsed.ref, "option_nbbo", "not_found");
      }
      case "equity_quote": {
        const quote = equityQuoteByKey.get(
          exactLookupKey(parsed.lookup.underlying_id.toUpperCase(), parsed.lookup.ts)
        );
        return quote
          ? { kind: "equity_quote", ref: parsed.ref, quote }
          : unresolved(parsed.ref, "equity_quote", "not_found");
      }
      case "equity_print": {
        const print = equityPrintByTraceId.get(parsed.traceId);
        return print
          ? { kind: "equity_print", ref: parsed.ref, print }
          : unresolved(parsed.ref, "equity_print", "not_found");
      }
      case "synthetic_label":
        return {
          kind: "synthetic_label",
          ref: parsed.ref,
          label: {
            label_type: parsed.labelType,
            label_id: parsed.labelId,
            context: parsed.context
          }
        };
      case "external_context":
        return {
          kind: "external_context",
          ref: parsed.ref,
          context: parsed.context
        };
      case "unresolved":
        return unresolved(parsed.ref, parsed.inferredKind, parsed.reason);
    }
    const exhaustive: never = parsed;
    return exhaustive;
  });

  return SmartFlowAlertEvidenceBundleSchema.parse({
    alert_id: request.alert_id,
    items
  });
};
