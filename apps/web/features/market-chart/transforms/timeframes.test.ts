import { describe, expect, it } from "bun:test";
import {
  buildTimeframeToolbarModel,
  createDefaultTimeframeFavorites,
  DEFAULT_MARKET_CHART_INTERVALS,
  parseSupportedTimeframeMs,
  readTimeframeFavorites,
  reduceTimeframeFavorites,
  TIMEFRAME_FAVORITES_STORAGE_KEY,
  writeTimeframeFavorites
} from "./timeframes";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FailingWriteStorage extends MemoryStorage {
  setItem(_key: string, _value: string) {
    throw new Error("storage unavailable");
  }
}

describe("market chart timeframe registry", () => {
  it("uses 1m, 5m, and 15m as default favorite intervals", () => {
    expect(DEFAULT_MARKET_CHART_INTERVALS).toEqual([
      { label: "1m", ms: 60_000 },
      { label: "5m", ms: 300_000 },
      { label: "15m", ms: 900_000 }
    ]);
    expect(createDefaultTimeframeFavorites().favoriteIds).toEqual(["1m", "5m", "15m"]);
  });

  it("removes unfavorited intervals from the toolbar while keeping the current interval selectable", () => {
    const favorites = reduceTimeframeFavorites(createDefaultTimeframeFavorites(), {
      type: "unfavorite",
      id: "15m"
    });
    const model = buildTimeframeToolbarModel({
      selectedIntervalMs: 900_000,
      favoriteIds: favorites.favoriteIds
    });

    expect(model.toolbarItems.map((item) => item.id)).toEqual(["1m", "5m"]);
    expect(model.selected.id).toBe("15m");
    expect(model.selected.favorite).toBe(false);
    expect(model.dropdownItems.find((item) => item.id === "15m")).toMatchObject({
      available: true,
      selected: true
    });
  });

  it("favorites supported dropdown intervals when service support enables them", () => {
    const supported = [60_000, 300_000, 900_000, 1_800_000];
    const favorites = reduceTimeframeFavorites(
      createDefaultTimeframeFavorites(supported),
      {
        type: "favorite",
        id: "30m"
      },
      supported
    );
    const model = buildTimeframeToolbarModel({
      selectedIntervalMs: 1_800_000,
      favoriteIds: favorites.favoriteIds,
      supportedIntervalMs: supported
    });

    expect(model.toolbarItems.map((item) => item.id)).toEqual(["1m", "5m", "15m", "30m"]);
    expect(model.selected).toMatchObject({ id: "30m", available: true, favorite: true });
  });

  it("marks unsupported registry intervals unavailable instead of quietly selecting them", () => {
    const favorites = reduceTimeframeFavorites(createDefaultTimeframeFavorites(), {
      type: "favorite",
      id: "30m"
    });
    const model = buildTimeframeToolbarModel({
      selectedIntervalMs: 1_800_000,
      favoriteIds: favorites.favoriteIds
    });

    expect(favorites.favoriteIds).toEqual(["1m", "5m", "15m"]);
    expect(model.selected.id).toBe("1m");
    expect(model.dropdownItems.find((item) => item.id === "30m")).toMatchObject({
      disabled: true,
      dropdownLabel: "30m unavailable"
    });
  });

  it("persists favorites with a versioned key", () => {
    const storage = new MemoryStorage();
    const state = reduceTimeframeFavorites(createDefaultTimeframeFavorites(), {
      type: "unfavorite",
      id: "5m"
    });

    writeTimeframeFavorites(storage, state);

    expect(storage.getItem(TIMEFRAME_FAVORITES_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, favoriteIds: ["1m", "15m"] })
    );
    expect(readTimeframeFavorites(storage)).toEqual({ favoriteIds: ["1m", "15m"] });
  });

  it("keeps favorite changes in memory when browser storage rejects writes", () => {
    const storage = new FailingWriteStorage();
    const state = reduceTimeframeFavorites(createDefaultTimeframeFavorites(), {
      type: "unfavorite",
      id: "5m"
    });

    expect(() => writeTimeframeFavorites(storage, state)).not.toThrow();
  });

  it("clamps malformed storage data back to defaults", () => {
    const storage = new MemoryStorage();
    storage.setItem(TIMEFRAME_FAVORITES_STORAGE_KEY, "{bad json");

    expect(readTimeframeFavorites(storage)).toEqual({
      favoriteIds: ["1m", "5m", "15m"]
    });

    storage.setItem(
      TIMEFRAME_FAVORITES_STORAGE_KEY,
      JSON.stringify({ version: 1, favoriteIds: ["1h", "bad", "5m"] })
    );

    expect(readTimeframeFavorites(storage)).toEqual({ favoriteIds: ["5m"] });
  });

  it("parses supported intervals from environment-style configuration", () => {
    expect(parseSupportedTimeframeMs("300000,900000,1800000,42")).toEqual([
      300_000, 900_000, 1_800_000
    ]);
    expect(parseSupportedTimeframeMs("bad")).toEqual([60_000, 300_000, 900_000]);
  });
});
