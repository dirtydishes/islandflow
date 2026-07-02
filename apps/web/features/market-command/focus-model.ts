export type BoardTickerFocusSource =
  | "ticker-rail"
  | "contract"
  | "flow-packet"
  | "equity"
  | "manual";

export type BoardTickerFocus = {
  symbol: string;
  source: BoardTickerFocusSource;
};

export const normalizeBoardTickerSymbol = (symbol: string): string | null => {
  const normalized = symbol
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");

  return normalized.length > 0 ? normalized.slice(0, 16) : null;
};

export const createBoardTickerFocus = (
  symbol: string,
  source: BoardTickerFocusSource
): BoardTickerFocus | null => {
  const normalized = normalizeBoardTickerSymbol(symbol);
  return normalized ? { symbol: normalized, source } : null;
};
