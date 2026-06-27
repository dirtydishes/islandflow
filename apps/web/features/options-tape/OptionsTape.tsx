"use client";

import type { FlowPacket, OptionFlowFilters, OptionNBBO, OptionPrint } from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { DurableTape } from "../durable-tape/components/DurableTape";
import type { DurableTapeFocusEvent } from "../durable-tape/types";
import {
  stableHydrationKey,
  stableOptionSupportNbboKey,
  terminalHydrationScheduler
} from "../terminal/hydration-scheduler";
import { OPTIONS_TAPE_COLUMNS, renderOptionsTapeRow } from "./columns";
import { buildDefaultOptionsTapeFilters, getOptionsTapeScopeFilters } from "./filters";
import {
  formatOptionsTapeContractLabel,
  getOptionsTapePrintCursor,
  getOptionsTapePrintKey,
  getOptionsTapeUnderlying,
  normalizeOptionsTapeContractId
} from "./format";
import { createOptionsTapeFilteredSource, useOptionsTapeArraySource } from "./source";
import {
  buildOptionsTapeSupportPacketMaps,
  buildOptionsTapeSupportRequest,
  createOptionsTapeSupportHydratingSource,
  mergeOptionsTapeSupportPackets
} from "./support-hydration";
import {
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowContextFromSupport,
  getOptionsTapeSmartFlowSummary
} from "./tinting";
import { OptionsTapeHelp, OptionsTapeSettings } from "./settings-controls";
import {
  buildDefaultOptionsTapeSettings,
  buildOptionsTapeTemplatesForSettings,
  normalizeOptionsTapeSettings,
  readOptionsTapeSettings,
  type OptionsTapeSettingsState,
  writeOptionsTapeSettings
} from "./settings";
import type {
  FlowPacketFocusRequest,
  OptionsTapeMode,
  OptionsTapeProps,
  OptionsTapeRowContext,
  OptionsTapeScope,
  OptionsTapeSmartFlowSupportResolution,
  OptionsTapeSourceScope
} from "./types";

const DEFAULT_TITLE = "Options Tape";
const OPTIONS_TAPE_DEFAULT_FEATURES = ["default", { key: "settingsGear", enabled: false }] as const;
const EMPTY_FLOW_PACKET_BY_ID = new Map<string, FlowPacket>();
const EMPTY_FLOW_PACKET_BY_TRACE_ID = new Map<string, FlowPacket>();
const EMPTY_PACKET_ID_BY_OPTION_TRACE_ID = new Map<string, string>();
const EMPTY_NBBO_BY_TRACE_ID = new Map<string, OptionNBBO | null>();
const EMPTY_SMART_FLOW_SUPPORT_BY_TRACE_ID = new Map<
  string,
  OptionsTapeSmartFlowSupportResolution
>();

const GLOBAL_SCOPE: OptionsTapeScope = { mode: "global" };

const getOptionsTapeSettingsStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const deriveMode = (scope: OptionsTapeScope): OptionsTapeMode =>
  scope.mode === "packet" ? "packet" : scope.mode === "contract" ? "contract" : "global";

const getPacketContractId = (packet: FlowPacket | undefined): string | undefined => {
  const value = packet?.features.option_contract_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const packetRequestFromPrint = ({
  print,
  packet,
  source
}: {
  print: OptionPrint;
  packet: FlowPacket;
  source: FlowPacketFocusRequest["source"];
}): FlowPacketFocusRequest => ({
  packetId: packet.id,
  memberTraceIds: packet.members,
  optionContractId: getPacketContractId(packet) ?? print.option_contract_id,
  source
});

const scopeToSourceScope = (scope: OptionsTapeScope): OptionsTapeSourceScope => {
  if (scope.mode === "global") {
    return {};
  }
  return {
    optionContractId: scope.optionContractId,
    underlyingIds: scope.underlyingId ? [scope.underlyingId] : undefined,
    packetId: scope.mode === "packet" ? scope.packetId : undefined,
    packetMemberTraceIds:
      scope.mode === "packet" && !scope.packetId ? scope.memberTraceIds : undefined,
    selectedTraceId: scope.mode === "packet" ? scope.selectedTraceId : undefined
  };
};

const getContractFocusScope = (
  print: OptionPrint,
  context?: OptionsTapeRowContext
): Extract<OptionsTapeScope, { mode: "contract" }> => ({
  mode: "contract",
  optionContractId: normalizeOptionsTapeContractId(print.option_contract_id),
  underlyingId: getOptionsTapeUnderlying(print),
  smartFlow: context?.smartFlow
});

const getPacketFocusScope = (
  print: OptionPrint,
  packet: FlowPacket,
  context?: OptionsTapeRowContext
): Extract<OptionsTapeScope, { mode: "packet" }> => ({
  mode: "packet",
  packetId: packet.id,
  memberTraceIds: packet.members,
  optionContractId:
    getPacketContractId(packet) ?? normalizeOptionsTapeContractId(print.option_contract_id),
  selectedTraceId: print.trace_id,
  underlyingId: getOptionsTapeUnderlying(print),
  smartFlow: context?.smartFlow
});

const mergeMaps = <K, V>(
  left: ReadonlyMap<K, V> | undefined,
  right: ReadonlyMap<K, V> | undefined
): ReadonlyMap<K, V> | undefined => {
  if (!left?.size) {
    return right?.size ? right : undefined;
  }
  if (!right?.size) {
    return left;
  }
  return new Map([...left, ...right]);
};

const renderScopeBand = ({
  scope,
  onShowAll,
  onClear
}: {
  scope: OptionsTapeScope;
  onShowAll: () => void;
  onClear: () => void;
}) => {
  if (scope.mode === "global") {
    return null;
  }
  const label = formatOptionsTapeContractLabel(scope.optionContractId);
  const smartFlowSummary = scope.smartFlow
    ? getOptionsTapeSmartFlowSummary(scope.smartFlow.projection)
    : null;
  return (
    <div className={`options-tape-scope-band options-tape-scope-${scope.mode}`}>
      <div className={`options-tape-scope-main ${smartFlowSummary ? "has-smart-flow" : ""}`.trim()}>
        <div className="options-tape-scope-focus">
          <span>{scope.mode === "packet" ? "Packet prints" : "Contract flow"}</span>
          <strong>{label}</strong>
          {scope.mode === "packet" ? (
            <em>
              {scope.packetId} / {scope.memberTraceIds.length.toLocaleString()} prints
            </em>
          ) : null}
        </div>
        {smartFlowSummary ? (
          <div className="options-tape-scope-smart-flow">
            <span>Smart-flow</span>
            <strong>{smartFlowSummary.hypothesis}</strong>
            <em>
              {smartFlowSummary.direction} / {smartFlowSummary.confidence} /{" "}
              {smartFlowSummary.abstention}
            </em>
          </div>
        ) : null}
      </div>
      <div className="options-tape-scope-actions">
        {scope.mode === "packet" ? (
          <button type="button" onClick={onShowAll}>
            Show contract
          </button>
        ) : null}
        <button type="button" onClick={onClear}>
          Back to tape
        </button>
      </div>
    </div>
  );
};

const rowContextFromPrint = ({
  print,
  flowPacketByTraceId,
  packetIdByOptionTraceId,
  flowPacketById,
  smartFlowSupportByTraceId,
  nbboByContractId,
  nbboByTraceId
}: Pick<
  OptionsTapeProps,
  | "flowPacketByTraceId"
  | "packetIdByOptionTraceId"
  | "flowPacketById"
  | "nbboByContractId"
  | "nbboByTraceId"
> & {
  print: OptionPrint;
  smartFlowSupportByTraceId?: ReadonlyMap<string, OptionsTapeSmartFlowSupportResolution>;
}): OptionsTapeRowContext => {
  const supportResolution = smartFlowSupportByTraceId?.get(print.trace_id);
  const packet =
    supportResolution?.packet ??
    flowPacketByTraceId?.get(print.trace_id) ??
    flowPacketById?.get(packetIdByOptionTraceId?.get(print.trace_id) ?? "");
  const nbbo =
    nbboByTraceId?.get(print.trace_id) ??
    nbboByContractId?.get(normalizeOptionsTapeContractId(print.option_contract_id));
  return {
    print,
    packet: packet
      ? {
          packet,
          packetId: packet.id,
          memberTraceIds: packet.members
        }
      : undefined,
    smartFlow: getOptionsTapeSmartFlowContextFromSupport({
      optionTraceId: print.trace_id,
      supportResolution,
      packetMemberTraceIds: packet?.members
    }),
    nbbo
  };
};

export const OptionsTape = ({
  title = DEFAULT_TITLE,
  ariaLabel = "Options tape",
  className,
  prints = [],
  source,
  sourceOptions,
  filters,
  onFiltersChange,
  template = "auto",
  features = OPTIONS_TAPE_DEFAULT_FEATURES,
  flowPacketByTraceId,
  packetIdByOptionTraceId,
  flowPacketById,
  smartFlowSupportByTraceId,
  nbboByContractId,
  nbboByTraceId,
  supportHydrationEnabled = true,
  focusedContractId,
  onContractFocus,
  onPacketFocus,
  onClearFocus,
  renderLinkedContext,
  rowHeight = 36,
  overscan = 10
}: OptionsTapeProps) => {
  const [localFilters, setLocalFilters] = useState<OptionFlowFilters>(() =>
    buildDefaultOptionsTapeFilters()
  );
  const activeFilters = filters ?? localFilters;
  const setFilters = onFiltersChange ?? setLocalFilters;
  const settingsStorage = useMemo(() => getOptionsTapeSettingsStorage(), []);
  const [moduleSettings, setModuleSettingsState] = useState<OptionsTapeSettingsState>(() =>
    buildDefaultOptionsTapeSettings()
  );
  const [moduleSettingsHydrated, setModuleSettingsHydrated] = useState(false);
  const setModuleSettings = useCallback<Dispatch<SetStateAction<OptionsTapeSettingsState>>>(
    (nextSettings) => {
      setModuleSettingsState((current) =>
        normalizeOptionsTapeSettings(
          typeof nextSettings === "function" ? nextSettings(current) : nextSettings
        )
      );
    },
    []
  );
  const [scope, setScope] = useState<OptionsTapeScope>(GLOBAL_SCOPE);
  const mountedRef = useRef(true);
  const supportContextRef = useRef({
    smartFlowSupportByTraceId: EMPTY_SMART_FLOW_SUPPORT_BY_TRACE_ID as ReadonlyMap<
      string,
      OptionsTapeSmartFlowSupportResolution
    >,
    nbboByTraceId: EMPTY_NBBO_BY_TRACE_ID as ReadonlyMap<string, OptionNBBO | null>
  });
  const pendingSupportRequestKeysRef = useRef(new Set<string>());
  const currentFocusedContractId = focusedContractId ?? null;
  const previousFocusedContractIdRef = useRef<string | null>(currentFocusedContractId);
  const [hydratedPackets, setHydratedPackets] = useState<FlowPacket[]>([]);
  const [hydratedSmartFlowSupportByTraceId, setHydratedSmartFlowSupportByTraceId] = useState<
    Map<string, OptionsTapeSmartFlowSupportResolution>
  >(() => new Map());
  const [hydratedNbboByTraceId, setHydratedNbboByTraceId] = useState<
    Map<string, OptionNBBO | null>
  >(() => new Map());
  const mode = deriveMode(scope);
  const sourceScope = useMemo(() => scopeToSourceScope(scope), [scope]);
  const sourceFilters = useMemo(
    () => getOptionsTapeScopeFilters(sourceScope, activeFilters),
    [activeFilters, sourceScope]
  );
  const templates = useMemo(
    () => buildOptionsTapeTemplatesForSettings(mode, moduleSettings),
    [mode, moduleSettings]
  );
  const hydratedPacketMaps = useMemo(
    () => buildOptionsTapeSupportPacketMaps(hydratedPackets),
    [hydratedPackets]
  );
  const mergedFlowPacketById = useMemo(
    () => mergeMaps(flowPacketById, hydratedPacketMaps.flowPacketById) ?? EMPTY_FLOW_PACKET_BY_ID,
    [flowPacketById, hydratedPacketMaps.flowPacketById]
  );
  const mergedFlowPacketByTraceId = useMemo(
    () =>
      mergeMaps(flowPacketByTraceId, hydratedPacketMaps.flowPacketByTraceId) ??
      EMPTY_FLOW_PACKET_BY_TRACE_ID,
    [flowPacketByTraceId, hydratedPacketMaps.flowPacketByTraceId]
  );
  const mergedPacketIdByOptionTraceId = useMemo(
    () =>
      mergeMaps(packetIdByOptionTraceId, hydratedPacketMaps.packetIdByOptionTraceId) ??
      EMPTY_PACKET_ID_BY_OPTION_TRACE_ID,
    [packetIdByOptionTraceId, hydratedPacketMaps.packetIdByOptionTraceId]
  );
  const mergedNbboByTraceId = useMemo(
    () => mergeMaps(hydratedNbboByTraceId, nbboByTraceId) ?? EMPTY_NBBO_BY_TRACE_ID,
    [hydratedNbboByTraceId, nbboByTraceId]
  );
  const mergedSmartFlowSupportByTraceId = useMemo(
    () =>
      mergeMaps(smartFlowSupportByTraceId, hydratedSmartFlowSupportByTraceId) ??
      EMPTY_SMART_FLOW_SUPPORT_BY_TRACE_ID,
    [hydratedSmartFlowSupportByTraceId, smartFlowSupportByTraceId]
  );
  const handlePacketHydrated = useCallback(
    (packet: FlowPacket | null) => {
      if (packet) {
        setHydratedPackets((current) => mergeOptionsTapeSupportPackets(current, [packet]));
      }
      sourceOptions?.onPacketHydrated?.(packet);
    },
    [sourceOptions]
  );
  const resolvedSourceOptions = useMemo(
    () => ({
      ...sourceOptions,
      onPacketHydrated: handlePacketHydrated
    }),
    [handlePacketHydrated, sourceOptions]
  );
  const tapeSource = useOptionsTapeArraySource({ prints, options: resolvedSourceOptions });
  const activeSource = source ?? tapeSource;

  useEffect(() => {
    setModuleSettingsState(readOptionsTapeSettings(settingsStorage));
    setModuleSettingsHydrated(true);
  }, [settingsStorage]);

  useEffect(() => {
    if (moduleSettingsHydrated) {
      writeOptionsTapeSettings(settingsStorage, moduleSettings);
    }
  }, [moduleSettings, moduleSettingsHydrated, settingsStorage]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    supportContextRef.current = {
      smartFlowSupportByTraceId: mergedSmartFlowSupportByTraceId,
      nbboByTraceId: mergedNbboByTraceId
    };
  }, [mergedNbboByTraceId, mergedSmartFlowSupportByTraceId]);

  const hydrateSupportRows = useCallback((rows: readonly OptionPrint[]) => {
    const request = buildOptionsTapeSupportRequest(rows, supportContextRef.current);
    const traceKey = stableHydrationKey(request.traceIds ?? []);
    const nbboKey = stableOptionSupportNbboKey(request.nbboContext ?? []);
    if (!traceKey && !nbboKey) {
      return;
    }
    const requestKey = `${traceKey}\n\n${nbboKey}`;
    if (pendingSupportRequestKeysRef.current.has(requestKey)) {
      return;
    }
    pendingSupportRequestKeysRef.current.add(requestKey);

    void terminalHydrationScheduler
      .requestOptionSupport(request)
      .then((payload) => {
        if (!mountedRef.current) {
          return;
        }
        const supportPackets = Array.from(payload.smartFlowSupportByTraceId.values())
          .map((support) => support.packet)
          .filter((packet): packet is FlowPacket => Boolean(packet));
        const packets = [...payload.packets, ...supportPackets];
        if (packets.length > 0) {
          setHydratedPackets((current) => mergeOptionsTapeSupportPackets(current, packets));
        }
        if (payload.smartFlowSupportByTraceId.size > 0) {
          setHydratedSmartFlowSupportByTraceId((current) => {
            const next = new Map(current);
            let changed = false;
            for (const [traceId, support] of payload.smartFlowSupportByTraceId) {
              if (next.get(traceId) !== support) {
                next.set(traceId, support);
                changed = true;
              }
            }
            return changed ? next : current;
          });
        }
        if (Object.keys(payload.nbboByTraceId).length > 0) {
          setHydratedNbboByTraceId((current) => {
            const next = new Map(current);
            for (const [traceId, quote] of Object.entries(payload.nbboByTraceId)) {
              next.set(traceId, quote);
            }
            return next;
          });
        }
      })
      .catch((error) => {
        if (mountedRef.current) {
          console.warn("Failed to hydrate options tape row support", error);
        }
      })
      .finally(() => {
        pendingSupportRequestKeysRef.current.delete(requestKey);
      });
  }, []);

  const supportHydratedSource = useMemo(
    () =>
      supportHydrationEnabled
        ? createOptionsTapeSupportHydratingSource(activeSource, hydrateSupportRows)
        : activeSource,
    [activeSource, hydrateSupportRows, supportHydrationEnabled]
  );

  useEffect(() => {
    const previousFocusedContractId = previousFocusedContractIdRef.current;
    previousFocusedContractIdRef.current = currentFocusedContractId;
    if (
      previousFocusedContractId !== null &&
      currentFocusedContractId === null &&
      scope.mode !== "global"
    ) {
      setScope(GLOBAL_SCOPE);
    }
  }, [currentFocusedContractId, scope.mode]);

  const contextForPrint = useCallback(
    (print: OptionPrint) =>
      rowContextFromPrint({
        print,
        flowPacketByTraceId: mergedFlowPacketByTraceId,
        packetIdByOptionTraceId: mergedPacketIdByOptionTraceId,
        flowPacketById: mergedFlowPacketById,
        smartFlowSupportByTraceId: mergedSmartFlowSupportByTraceId,
        nbboByContractId,
        nbboByTraceId: mergedNbboByTraceId
      }),
    [
      mergedFlowPacketById,
      mergedFlowPacketByTraceId,
      mergedNbboByTraceId,
      mergedPacketIdByOptionTraceId,
      mergedSmartFlowSupportByTraceId,
      nbboByContractId
    ]
  );
  const displaySource = useMemo(
    () =>
      moduleSettings.smartFlowOnly
        ? createOptionsTapeFilteredSource(supportHydratedSource, (print) =>
            Boolean(contextForPrint(print).smartFlow)
          )
        : supportHydratedSource,
    [contextForPrint, moduleSettings.smartFlowOnly, supportHydratedSource]
  );

  const rowTintForPrint = useCallback(
    (print: OptionPrint) => getOptionsTapeRowTintFromContext(contextForPrint(print)),
    [contextForPrint]
  );
  const selectedPacketTraceId = scope.mode === "packet" ? scope.selectedTraceId : undefined;
  const rowClassNameForPrint = useCallback(
    (print: OptionPrint) => {
      const classNames = [
        getOptionsTapeRowTintClassName(rowTintForPrint(print)),
        selectedPacketTraceId && print.trace_id === selectedPacketTraceId
          ? "options-tape-row-selected-print"
          : undefined
      ].filter(Boolean);
      return classNames.length > 0 ? classNames.join(" ") : undefined;
    },
    [rowTintForPrint, selectedPacketTraceId]
  );

  const clearScope = useCallback(() => {
    setScope(GLOBAL_SCOPE);
    onClearFocus?.();
  }, [onClearFocus]);

  const updateFilters = useCallback<Dispatch<SetStateAction<OptionFlowFilters>>>(
    (nextFilters) => {
      setScope(GLOBAL_SCOPE);
      onClearFocus?.();
      setFilters(nextFilters);
    },
    [onClearFocus, setFilters]
  );

  const showAllForContract = useCallback(() => {
    if (scope.mode !== "packet") {
      return;
    }
    setScope({
      mode: "contract",
      optionContractId: scope.optionContractId,
      underlyingId: scope.underlyingId,
      smartFlow: scope.smartFlow
    });
  }, [scope]);

  const activatePrint = useCallback(
    (event: DurableTapeFocusEvent<OptionPrint>) => {
      const context = contextForPrint(event.item);
      const { print, packet } = context;
      if (packet?.packet) {
        const nextScope = getPacketFocusScope(print, packet.packet, context);
        onContractFocus?.(print);
        onPacketFocus?.(
          packetRequestFromPrint({ print, packet: packet.packet, source: "options-tape" })
        );
        setScope(nextScope);
        return;
      }
      onContractFocus?.(print);
      setScope(getContractFocusScope(print, context));
    },
    [contextForPrint, onContractFocus, onPacketFocus]
  );

  const renderHover = useCallback(
    ({ item }: { item: OptionPrint }) => {
      const context = contextForPrint(item);
      const parsed = parseOptionContractId(item.option_contract_id);
      const linked = renderLinkedContext?.(context);
      const smartFlowSummary = context.smartFlow
        ? getOptionsTapeSmartFlowSummary(context.smartFlow.projection)
        : null;
      const rows = [
        ["Contract", item.option_contract_id],
        ["Root", parsed?.root.toUpperCase() ?? getOptionsTapeUnderlying(item)],
        ["Trace", item.trace_id],
        ["Exchange", item.exchange],
        ["Conditions", item.conditions?.join(", ") || "--"],
        ["NBBO", context.nbbo ? `${context.nbbo.bid} x ${context.nbbo.ask}` : "--"],
        [
          "Quote age",
          item.execution_nbbo_age_ms ? `${Math.round(item.execution_nbbo_age_ms)}ms` : "--"
        ],
        ["IV source", item.execution_iv_source ?? "--"],
        ["Signal", item.signal_profile ?? (item.signal_pass ? "signal" : "--")],
        ["Reasons", item.signal_reasons?.join(", ") || "--"],
        ["Packet", context.packet?.packetId ?? "--"],
        ...(smartFlowSummary
          ? [
              ["Flow hypothesis", smartFlowSummary.hypothesis],
              ["Flow direction", smartFlowSummary.direction],
              ["Flow confidence", smartFlowSummary.confidence],
              ["Flow abstention", smartFlowSummary.abstention]
            ]
          : [])
      ];
      return (
        <div className="options-tape-hover-content" aria-label="Options print detail">
          <dl>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {linked ? <div className="options-tape-linked-context">{linked}</div> : null}
        </div>
      );
    },
    [contextForPrint, renderLinkedContext]
  );

  return (
    <section className={`options-tape-module ${className ?? ""}`.trim()}>
      <div className="options-tape-control-row">
        <div>
          <span>View</span>
          <strong>
            {activeFilters.view === "raw" ? "all prints" : "signal prints"}
            {moduleSettings.smartFlowOnly ? " / smart-flow only" : ""}
          </strong>
        </div>
        <div className="options-tape-control-actions">
          <OptionsTapeHelp />
          <OptionsTapeSettings
            filters={activeFilters}
            settings={moduleSettings}
            onApplyFilters={updateFilters}
            onApplySettings={setModuleSettings}
          />
        </div>
      </div>
      {renderScopeBand({ scope, onShowAll: showAllForContract, onClear: clearScope })}
      <DurableTape
        ariaLabel={ariaLabel}
        className={`options-tape options-tape-mode-${mode}`}
        columns={OPTIONS_TAPE_COLUMNS}
        features={features}
        filters={sourceFilters}
        getCursor={getOptionsTapePrintCursor}
        getRowClassName={({ item }) => rowClassNameForPrint(item)}
        getRowKey={getOptionsTapePrintKey}
        getRowStyle={({ item }) => getOptionsTapeRowTintStyle(rowTintForPrint(item))}
        onActivate={activatePrint}
        renderHover={renderHover}
        renderRow={({ item, columns }) =>
          renderOptionsTapeRow({
            context: contextForPrint(item),
            columns
          })
        }
        rowHeight={rowHeight}
        overscan={overscan}
        scope={sourceScope}
        source={displaySource}
        template={template}
        templates={templates}
        title={title}
      />
    </section>
  );
};
