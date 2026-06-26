"use client";

import type {
  FlowPacket,
  OptionFlowFilters,
  OptionNBBO,
  OptionPrint,
  SmartFlowExplainabilityProjection
} from "@islandflow/types";
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
import {
  OPTIONS_TAPE_COLUMNS,
  OPTIONS_TAPE_TEMPLATES_BY_MODE,
  renderOptionsTapeRow
} from "./columns";
import {
  applyOptionsTapeSecurityPreset,
  applyOptionsTapeSidePreset,
  applyOptionsTapeTypePreset,
  applyOptionsTapeView,
  buildDefaultOptionsTapeFilters,
  getOptionsTapeScopeFilters,
  getOptionsTapeSidePreset
} from "./filters";
import {
  formatOptionsTapeContractLabel,
  getOptionsTapePrintCursor,
  getOptionsTapePrintKey,
  getOptionsTapeUnderlying,
  normalizeOptionsTapeContractId
} from "./format";
import { useOptionsTapeArraySource } from "./source";
import {
  buildOptionsTapeSupportPacketMaps,
  buildOptionsTapeSupportRequest,
  createOptionsTapeSupportHydratingSource,
  mergeOptionsTapeSmartFlowProjections,
  mergeOptionsTapeSupportPackets
} from "./support-hydration";
import {
  buildOptionsTapeSmartFlowContextByTraceId,
  getOptionsTapeRowTintFromContext,
  getOptionsTapeRowTintClassName,
  getOptionsTapeRowTintStyle,
  getOptionsTapeSmartFlowSummary
} from "./tinting";
import type {
  FlowPacketFocusRequest,
  OptionsTapeMode,
  OptionsTapeProps,
  OptionsTapeRowContext,
  OptionsTapeScope,
  OptionsTapeSourceScope
} from "./types";

const DEFAULT_TITLE = "Options Tape";
const OPTIONS_TAPE_DEFAULT_FEATURES = ["default", { key: "settingsGear", enabled: false }] as const;
const EMPTY_FLOW_PACKET_BY_ID = new Map<string, FlowPacket>();
const EMPTY_FLOW_PACKET_BY_TRACE_ID = new Map<string, FlowPacket>();
const EMPTY_PACKET_ID_BY_OPTION_TRACE_ID = new Map<string, string>();
const EMPTY_NBBO_BY_TRACE_ID = new Map<string, OptionNBBO | null>();

const GLOBAL_SCOPE: OptionsTapeScope = { mode: "global" };

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
    packetMemberTraceIds: scope.mode === "packet" ? scope.memberTraceIds : undefined
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

const OptionsTapeSettings = ({
  filters,
  onChange
}: {
  filters: OptionFlowFilters;
  onChange: Dispatch<SetStateAction<OptionFlowFilters>>;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sidePreset = getOptionsTapeSidePreset(filters);
  const premiumPresets = [
    { label: "All", value: undefined },
    { label: ">= 25K", value: 25_000 },
    { label: ">= 50K", value: 50_000 },
    { label: ">= 100K", value: 100_000 }
  ];
  const customPremium = typeof filters.minNotional === "number" ? filters.minNotional : "";

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`options-tape-settings ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="options-tape-gear"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        Settings
      </button>
      {open ? (
        <div
          className="options-tape-settings-panel"
          role="dialog"
          aria-label="Options tape filters"
        >
          <div className="options-tape-settings-head">
            <strong>Options Filters</strong>
            <button
              className="terminal-button"
              type="button"
              onClick={() => onChange(buildDefaultOptionsTapeFilters())}
            >
              Reset
            </button>
          </div>
          <section>
            <span>View</span>
            <div className="options-tape-chip-row">
              {[
                { label: "Signal prints", value: "signal" as const },
                { label: "All prints", value: "raw" as const }
              ].map((preset) => (
                <button
                  className={filters.view === preset.value ? "is-active" : ""}
                  key={preset.value}
                  type="button"
                  onClick={() => onChange((current) => applyOptionsTapeView(current, preset.value))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Side</span>
            <div className="options-tape-chip-row options-tape-chip-row-wide">
              {[
                ["Default", "default"],
                ["AA only", "aa"],
                ["Ask side", "ask"],
                ["Mid", "mid"],
                ["Bid side", "bid"],
                ["BB only", "bb"],
                ["Custom", "custom"]
              ].map(([label, value]) => (
                <button
                  className={sidePreset === value ? "is-active" : ""}
                  key={value}
                  type="button"
                  onClick={() =>
                    onChange((current) => applyOptionsTapeSidePreset(current, value as never))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Type</span>
            <div className="options-tape-chip-row">
              {[
                ["Calls", "calls"],
                ["Puts", "puts"],
                ["Calls + Puts", "both"]
              ].map(([label, value]) => (
                <button
                  className={
                    (value === "calls" && filters.optionTypes?.join() === "call") ||
                    (value === "puts" && filters.optionTypes?.join() === "put") ||
                    (value === "both" && (filters.optionTypes?.length ?? 0) !== 1)
                      ? "is-active"
                      : ""
                  }
                  key={value}
                  type="button"
                  onClick={() =>
                    onChange((current) => applyOptionsTapeTypePreset(current, value as never))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Security</span>
            <div className="options-tape-chip-row">
              {[
                ["Stocks", "stocks"],
                ["ETFs", "etfs"],
                ["All", "all"]
              ].map(([label, value]) => (
                <button
                  className={
                    (value === "stocks" && filters.securityTypes?.join() === "stock") ||
                    (value === "etfs" && filters.securityTypes?.join() === "etf") ||
                    (value === "all" && (filters.securityTypes?.length ?? 0) !== 1)
                      ? "is-active"
                      : ""
                  }
                  key={value}
                  type="button"
                  onClick={() =>
                    onChange((current) => applyOptionsTapeSecurityPreset(current, value as never))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span>Premium</span>
            <div className="options-tape-chip-row">
              {premiumPresets.map((preset) => (
                <button
                  className={filters.minNotional === preset.value ? "is-active" : ""}
                  key={preset.label}
                  type="button"
                  onClick={() => onChange((current) => ({ ...current, minNotional: preset.value }))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="options-tape-custom-premium">
              <span>Custom</span>
              <input
                inputMode="numeric"
                min={0}
                type="number"
                value={customPremium}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onChange((current) => ({
                    ...current,
                    minNotional: Number.isFinite(value) && value > 0 ? value : undefined
                  }));
                }}
              />
            </label>
          </section>
        </div>
      ) : null}
    </div>
  );
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
          {scope.mode === "packet" ? <em>{scope.packetId}</em> : null}
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
            Show all
          </button>
        ) : null}
        <button type="button" onClick={onClear}>
          Clear
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
  smartFlowContextByTraceId,
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
  smartFlowContextByTraceId?: ReadonlyMap<string, OptionsTapeRowContext["smartFlow"]>;
}): OptionsTapeRowContext => {
  const packet =
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
    smartFlow: smartFlowContextByTraceId?.get(print.trace_id),
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
  smartFlowProjections,
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
  const [scope, setScope] = useState<OptionsTapeScope>(GLOBAL_SCOPE);
  const tapeSource = useOptionsTapeArraySource({ prints, options: sourceOptions });
  const activeSource = source ?? tapeSource;
  const mountedRef = useRef(true);
  const supportContextRef = useRef({
    smartFlowContextByTraceId: new Map<string, OptionsTapeRowContext["smartFlow"]>(),
    nbboByTraceId: EMPTY_NBBO_BY_TRACE_ID as ReadonlyMap<string, OptionNBBO | null>
  });
  const pendingSupportRequestKeysRef = useRef(new Set<string>());
  const [hydratedPackets, setHydratedPackets] = useState<FlowPacket[]>([]);
  const [hydratedSmartFlowProjections, setHydratedSmartFlowProjections] = useState<
    SmartFlowExplainabilityProjection[]
  >([]);
  const [hydratedNbboByTraceId, setHydratedNbboByTraceId] = useState<
    Map<string, OptionNBBO | null>
  >(() => new Map());
  const mode = deriveMode(scope);
  const sourceScope = useMemo(() => scopeToSourceScope(scope), [scope]);
  const sourceFilters = useMemo(
    () => getOptionsTapeScopeFilters(sourceScope, activeFilters),
    [activeFilters, sourceScope]
  );
  const templates = OPTIONS_TAPE_TEMPLATES_BY_MODE[mode];
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
  const mergedSmartFlowProjections = useMemo(
    () =>
      mergeOptionsTapeSmartFlowProjections(
        smartFlowProjections ?? [],
        hydratedSmartFlowProjections
      ),
    [hydratedSmartFlowProjections, smartFlowProjections]
  );
  const smartFlowContextByTraceId = useMemo(
    () =>
      buildOptionsTapeSmartFlowContextByTraceId({
        projections: mergedSmartFlowProjections,
        flowPacketById: mergedFlowPacketById,
        flowPacketByTraceId: mergedFlowPacketByTraceId
      }),
    [mergedFlowPacketById, mergedFlowPacketByTraceId, mergedSmartFlowProjections]
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    supportContextRef.current = {
      smartFlowContextByTraceId,
      nbboByTraceId: mergedNbboByTraceId
    };
  }, [mergedNbboByTraceId, smartFlowContextByTraceId]);

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
        if (payload.packets.length > 0) {
          setHydratedPackets((current) => mergeOptionsTapeSupportPackets(current, payload.packets));
        }
        if (payload.smartFlowProjections.length > 0) {
          setHydratedSmartFlowProjections((current) =>
            mergeOptionsTapeSmartFlowProjections(current, payload.smartFlowProjections)
          );
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
    if (focusedContractId === null && scope.mode !== "global") {
      setScope(GLOBAL_SCOPE);
    }
  }, [focusedContractId, scope.mode]);

  const contextForPrint = useCallback(
    (print: OptionPrint) =>
      rowContextFromPrint({
        print,
        flowPacketByTraceId: mergedFlowPacketByTraceId,
        packetIdByOptionTraceId: mergedPacketIdByOptionTraceId,
        flowPacketById: mergedFlowPacketById,
        smartFlowContextByTraceId,
        nbboByContractId,
        nbboByTraceId: mergedNbboByTraceId
      }),
    [
      mergedFlowPacketById,
      mergedFlowPacketByTraceId,
      mergedNbboByTraceId,
      mergedPacketIdByOptionTraceId,
      nbboByContractId,
      smartFlowContextByTraceId
    ]
  );

  const rowTintForPrint = useCallback(
    (print: OptionPrint) => getOptionsTapeRowTintFromContext(contextForPrint(print)),
    [contextForPrint]
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
        setScope(nextScope);
        onContractFocus?.(print);
        onPacketFocus?.(
          packetRequestFromPrint({ print, packet: packet.packet, source: "options-tape" })
        );
        return;
      }
      setScope(getContractFocusScope(print, context));
      onContractFocus?.(print);
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
          <strong>{activeFilters.view === "raw" ? "all prints" : "signal prints"}</strong>
        </div>
        <OptionsTapeSettings filters={activeFilters} onChange={updateFilters} />
      </div>
      {renderScopeBand({ scope, onShowAll: showAllForContract, onClear: clearScope })}
      <DurableTape
        ariaLabel={ariaLabel}
        className={`options-tape options-tape-mode-${mode}`}
        columns={OPTIONS_TAPE_COLUMNS}
        features={features}
        filters={sourceFilters}
        getCursor={getOptionsTapePrintCursor}
        getRowClassName={({ item }) => getOptionsTapeRowTintClassName(rowTintForPrint(item))}
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
        source={supportHydratedSource}
        template={template}
        templates={templates}
        title={title}
      />
    </section>
  );
};
