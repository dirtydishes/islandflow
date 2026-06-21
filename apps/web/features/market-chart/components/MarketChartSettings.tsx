"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MARKET_CHART_PRICE_MODE_REGISTRY,
  type MarketChartPriceModeDefinition
} from "../transforms/candles";
import {
  MARKET_CHART_LOWER_PANE_MODE_REGISTRY,
  resolveLowerPaneMode,
  type MarketChartLowerPaneModeDefinition
} from "../transforms/lower-pane";
import type { MarketChartSettingsAction } from "../transforms/settings";
import type {
  MarketChartLowerPaneAvailableData,
  MarketChartSettingsCapabilities,
  MarketChartSettingsState
} from "../types";
import type { TimeframeToolbarItem } from "../transforms/timeframes";

type MarketChartSettingsProps = {
  settings: MarketChartSettingsState;
  availableData: MarketChartLowerPaneAvailableData;
  timeframeItems: readonly TimeframeToolbarItem[];
  onAction: (action: MarketChartSettingsAction) => void;
  capabilities?: MarketChartSettingsCapabilities;
  priceModes?: readonly MarketChartPriceModeDefinition[];
  lowerPaneModes?: readonly MarketChartLowerPaneModeDefinition[];
};

type PanelPosition = {
  top: number;
  left: number;
};

const PANEL_WIDTH = 380;
const VIEWPORT_GAP = 10;

const capabilityAllows = (ids: readonly string[] | undefined, id: string): boolean =>
  !ids || ids.includes(id);

export const MarketChartSettings = ({
  settings,
  availableData,
  timeframeItems,
  onAction,
  capabilities,
  priceModes = MARKET_CHART_PRICE_MODE_REGISTRY,
  lowerPaneModes = MARKET_CHART_LOWER_PANE_MODE_REGISTRY
}: MarketChartSettingsProps) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeLowerPaneMode = resolveLowerPaneMode(settings, availableData);

  const visiblePriceModes = useMemo(
    () => priceModes.filter((mode) => capabilityAllows(capabilities?.priceRendererIds, mode.id)),
    [capabilities?.priceRendererIds, priceModes]
  );
  const visibleLowerPaneModes = useMemo(
    () =>
      lowerPaneModes.filter((mode) => capabilityAllows(capabilities?.lowerPaneModeIds, mode.id)),
    [capabilities?.lowerPaneModeIds, lowerPaneModes]
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 480;
    const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
    if (window.innerWidth <= 720) {
      setPosition({
        top: Math.max(VIEWPORT_GAP, window.innerHeight - panelHeight - VIEWPORT_GAP),
        left: VIEWPORT_GAP
      });
      return;
    }
    setPosition({
      top: Math.max(
        VIEWPORT_GAP,
        Math.min(rect.bottom + 8, window.innerHeight - panelHeight - VIEWPORT_GAP)
      ),
      left: Math.min(
        Math.max(VIEWPORT_GAP, rect.right - panelWidth),
        window.innerWidth - panelWidth - VIEWPORT_GAP
      )
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || triggerRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePosition]);

  return (
    <div className="market-chart-settings">
      <button
        ref={triggerRef}
        className={`market-chart-settings-trigger${open ? " is-active" : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title="Chart settings"
      >
        Settings
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="market-chart-settings-panel"
          role="dialog"
          aria-label="Chart settings"
          style={{ top: position.top, left: position.left }}
        >
          <div className="market-chart-settings-head">
            <div className="market-chart-settings-title">Chart Settings</div>
            <div className="market-chart-settings-actions">
              <button type="button" onClick={() => onAction({ type: "reset" })}>
                Reset
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>

          <section className="market-chart-settings-section">
            <h3>Price Chart</h3>
            <div className="market-chart-segmented" role="group" aria-label="Price chart type">
              {visiblePriceModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={settings.price.rendererId === mode.id ? "is-active" : ""}
                  aria-pressed={settings.price.rendererId === mode.id}
                  onClick={() => onAction({ type: "set-price-renderer", rendererId: mode.id })}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="market-chart-settings-check">
              <input
                type="checkbox"
                checked={settings.price.showWicks}
                onChange={(event) =>
                  onAction({ type: "set-price-wicks", showWicks: event.currentTarget.checked })
                }
              />
              <span>Show wicks</span>
            </label>
          </section>

          <section className="market-chart-settings-section">
            <h3>Lower Chart</h3>
            <div className="market-chart-segmented" role="group" aria-label="Lower chart source">
              {visibleLowerPaneModes.map((mode) => {
                const available = mode.isAvailable?.(availableData) ?? true;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={activeLowerPaneMode === mode.id ? "is-active" : ""}
                    aria-pressed={activeLowerPaneMode === mode.id}
                    disabled={!available}
                    onClick={() => onAction({ type: "set-lower-pane-mode", mode: mode.id })}
                    title={mode.description}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            <label className="market-chart-settings-check">
              <input
                type="checkbox"
                checked={settings.lowerPane.visible}
                onChange={(event) =>
                  onAction({
                    type: "set-lower-pane-visible",
                    visible: event.currentTarget.checked
                  })
                }
              />
              <span>Show lower chart</span>
            </label>
          </section>

          <section className="market-chart-settings-section">
            <h3>Timeframes</h3>
            <div className="market-chart-settings-menu" aria-label="Favorite timeframes">
              {timeframeItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.favorite ? "is-active" : ""}
                  disabled={item.disabled}
                  aria-pressed={item.favorite}
                  onClick={() => onAction({ type: "toggle-timeframe-favorite", id: item.id })}
                >
                  <span>{item.label}</span>
                  <span>{item.favorite ? "Favorite" : "Hidden"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="market-chart-settings-section">
            <h3>Display</h3>
            <div className="market-chart-settings-grid">
              <label className="market-chart-settings-check">
                <input
                  type="checkbox"
                  checked={settings.display.showGrid}
                  onChange={(event) =>
                    onAction({
                      type: "set-display",
                      key: "showGrid",
                      value: event.currentTarget.checked
                    })
                  }
                />
                <span>Grid</span>
              </label>
              <label className="market-chart-settings-check">
                <input
                  type="checkbox"
                  checked={settings.display.showMarkers}
                  onChange={(event) =>
                    onAction({
                      type: "set-display",
                      key: "showMarkers",
                      value: event.currentTarget.checked
                    })
                  }
                />
                <span>Markers</span>
              </label>
              {capabilities?.showOverlaySettings !== false ? (
                <label className="market-chart-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.display.showOverlays}
                    onChange={(event) =>
                      onAction({
                        type: "set-display",
                        key: "showOverlays",
                        value: event.currentTarget.checked
                      })
                    }
                  />
                  <span>Off-ex overlay</span>
                </label>
              ) : null}
              {capabilities?.showSmartFlowMarkerSettings !== false ? (
                <label className="market-chart-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.display.showSmartFlowMarkers}
                    onChange={(event) =>
                      onAction({
                        type: "set-display",
                        key: "showSmartFlowMarkers",
                        value: event.currentTarget.checked
                      })
                    }
                  />
                  <span>Flow markers</span>
                </label>
              ) : null}
              {capabilities?.showInferredDarkMarkerSettings !== false ? (
                <label className="market-chart-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.display.showInferredDarkMarkers}
                    onChange={(event) =>
                      onAction({
                        type: "set-display",
                        key: "showInferredDarkMarkers",
                        value: event.currentTarget.checked
                      })
                    }
                  />
                  <span>Dark markers</span>
                </label>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
