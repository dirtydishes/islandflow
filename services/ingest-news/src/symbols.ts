import type { NewsSymbolResolution } from "@islandflow/types";

const TICKER_ANCHOR_RE = />\s*([A-Z]{1,5})\s*<\/a>/g;
const EXCHANGE_TICKER_RE = /\b(?:NASDAQ|NYSE|NYSEAMERICAN|AMEX|OTC|CBOE):([A-Z]{1,5})\b/g;
const DOLLAR_TICKER_RE = /\$([A-Z]{1,5})\b/g;

const normalizeSymbols = (symbols: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of symbols) {
    const symbol = entry.trim().toUpperCase();
    if (!symbol || !/^[A-Z]{1,5}$/.test(symbol) || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    normalized.push(symbol);
  }

  return normalized;
};

const collectMatches = (value: string, regex: RegExp): string[] => {
  regex.lastIndex = 0;
  const matches: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(value)) !== null) {
    matches.push(match[1] ?? "");
  }
  return matches;
};

export const resolveNewsSymbols = (
  providerSymbols: string[],
  contentHtml: string
): {
  provider_symbols: string[];
  resolved_symbols: string[];
  symbol_resolution: NewsSymbolResolution;
} => {
  const normalizedProvider = normalizeSymbols(providerSymbols);
  const derived = normalizeSymbols([
    ...collectMatches(contentHtml, TICKER_ANCHOR_RE),
    ...collectMatches(contentHtml, EXCHANGE_TICKER_RE),
    ...collectMatches(contentHtml, DOLLAR_TICKER_RE)
  ]);

  if (normalizedProvider.length > 0) {
    const merged = normalizeSymbols([...normalizedProvider, ...derived]);
    return {
      provider_symbols: normalizedProvider,
      resolved_symbols: merged,
      symbol_resolution: derived.length > 0 ? "mixed" : "provider"
    };
  }

  if (derived.length > 0) {
    return {
      provider_symbols: [],
      resolved_symbols: derived,
      symbol_resolution: "derived"
    };
  }

  return {
    provider_symbols: [],
    resolved_symbols: [],
    symbol_resolution: "none"
  };
};
