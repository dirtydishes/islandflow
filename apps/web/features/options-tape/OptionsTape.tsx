"use client";

import type { FlowPacket, OptionFlowFilters, OptionPrint } from "@islandflow/types";
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

import { DurableTape, type DurableTapeFocusEvent } from "../durable-tape";
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
import type {
  FlowPacketFocusRequest,
  OptionsTapeMode,
  OptionsTapeProps,
  OptionsTapeRowContext,
  OptionsTapeScope,
  OptionsTapeSourceScope
} from "./types";

const DEFAULT_TITLE = "Options Tape";
const OPTIONS_TAPE_DEFAULT_FEATURES = [
  "default",
  { key: "settingsGear", enabled: false }
] as const;

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

const getContractFocusScope = (print: OptionPrint): Extract<OptionsTapeScope, { mode: "contract" }> => ({
  mode: "contract",
  optionContractId: normalizeOptionsTapeContractId(print.option_contract_id),
  underlyingId: getOptionsTapeUnderlying(print)
});

const getPacketFocusScope = (
  print: OptionPrint,
  packet: FlowPacket
): Extract<OptionsTapeScope, { mode: "packet" }> => ({
  mode: "packet",
  packetId: packet.id,
  memberTraceIds: packet.members,
  optionContractId: getPacketContractId(packet) ?? normalizeOptionsTapeContractId(print.option_contract_id),
  underlyingId: getOptionsTapeUnderlying(print)
});

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
        <div className="options-tape-settings-panel" role="dialog" aria-label="Options tape filters">
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
  return (
    <div className={`options-tape-scope-band options-tape-scope-${scope.mode}`}>
      <div>
        <span>{scope.mode === "packet" ? "Packet prints" : "Contract flow"}</span>
        <strong>{label}</strong>
        {scope.mode === "packet" ? <em>{scope.packetId}</em> : null}
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
  decorByTraceId,
  nbboByContractId,
  nbboByTraceId
}: Pick<
  OptionsTapeProps,
  | "flowPacketByTraceId"
  | "packetIdByOptionTraceId"
  | "flowPacketById"
  | "decorByTraceId"
  | "nbboByContractId"
  | "nbboByTraceId"
> & {
  print: OptionPrint;
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
    decor: decorByTraceId?.get(print.trace_id),
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
  decorByTraceId,
  nbboByContractId,
  nbboByTraceId,
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
  const mode = deriveMode(scope);
  const sourceScope = useMemo(() => scopeToSourceScope(scope), [scope]);
  const templates = OPTIONS_TAPE_TEMPLATES_BY_MODE[mode];

  useEffect(() => {
    if (!focusedContractId && scope.mode !== "global") {
      setScope(GLOBAL_SCOPE);
    }
  }, [focusedContractId, scope.mode]);

  const contextForPrint = useCallback(
    (print: OptionPrint) =>
      rowContextFromPrint({
        print,
        flowPacketByTraceId,
        packetIdByOptionTraceId,
        flowPacketById,
        decorByTraceId,
        nbboByContractId,
        nbboByTraceId
      }),
    [
      decorByTraceId,
      flowPacketById,
      flowPacketByTraceId,
      nbboByContractId,
      nbboByTraceId,
      packetIdByOptionTraceId
    ]
  );

  const clearScope = useCallback(() => {
    setScope(GLOBAL_SCOPE);
    onClearFocus?.();
  }, [onClearFocus]);

  const showAllForContract = useCallback(() => {
    if (scope.mode !== "packet") {
      return;
    }
    setScope({
      mode: "contract",
      optionContractId: scope.optionContractId,
      underlyingId: scope.underlyingId
    });
  }, [scope]);

  const activatePrint = useCallback(
    (event: DurableTapeFocusEvent<OptionPrint>) => {
      const { print, packet } = contextForPrint(event.item);
      if (packet?.packet) {
        const nextScope = getPacketFocusScope(print, packet.packet);
        setScope(nextScope);
        onContractFocus?.(print);
        onPacketFocus?.(packetRequestFromPrint({ print, packet: packet.packet, source: "options-tape" }));
        return;
      }
      setScope(getContractFocusScope(print));
      onContractFocus?.(print);
    },
    [contextForPrint, onContractFocus, onPacketFocus]
  );

  const renderHover = useCallback(
    ({ item }: { item: OptionPrint }) => {
      const context = contextForPrint(item);
      const parsed = parseOptionContractId(item.option_contract_id);
      const linked = renderLinkedContext?.(context);
      const rows = [
        ["Contract", item.option_contract_id],
        ["Root", parsed?.root.toUpperCase() ?? getOptionsTapeUnderlying(item)],
        ["Trace", item.trace_id],
        ["Exchange", item.exchange],
        ["Conditions", item.conditions?.join(", ") || "--"],
        ["NBBO", context.nbbo ? `${context.nbbo.bid} x ${context.nbbo.ask}` : "--"],
        ["Quote age", item.execution_nbbo_age_ms ? `${Math.round(item.execution_nbbo_age_ms)}ms` : "--"],
        ["IV source", item.execution_iv_source ?? "--"],
        ["Signal", item.signal_profile ?? (item.signal_pass ? "signal" : "--")],
        ["Reasons", item.signal_reasons?.join(", ") || "--"],
        ["Packet", context.packet?.packetId ?? "--"]
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
        <OptionsTapeSettings filters={activeFilters} onChange={setFilters} />
      </div>
      {renderScopeBand({ scope, onShowAll: showAllForContract, onClear: clearScope })}
      <DurableTape
        ariaLabel={ariaLabel}
        className={`options-tape options-tape-mode-${mode}`}
        columns={OPTIONS_TAPE_COLUMNS}
        features={features}
        filters={activeFilters}
        getCursor={getOptionsTapePrintCursor}
        getRowKey={getOptionsTapePrintKey}
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
        source={activeSource}
        template={template}
        templates={templates}
        title={title}
      />
    </section>
  );
};
