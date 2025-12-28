import type { EquityPrint, EquityQuote } from "@islandflow/types";

export type StopHandler = () => void | Promise<void>;

export type EquityIngestHandlers = {
  onTrade: (print: EquityPrint) => void | Promise<void>;
  onQuote?: (quote: EquityQuote) => void | Promise<void>;
};

export type EquityIngestAdapter = {
  name: string;
  start: (handlers: EquityIngestHandlers) => StopHandler | Promise<StopHandler>;
};
