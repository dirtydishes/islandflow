import type { OptionNBBO, OptionPrint } from "@islandflow/types";

export type StopHandler = () => void | Promise<void>;

export type OptionIngestHandlers = {
  onTrade: (print: OptionPrint) => void | Promise<void>;
  onNBBO?: (nbbo: OptionNBBO) => void | Promise<void>;
};

export type OptionIngestAdapter = {
  name: string;
  start: (handlers: OptionIngestHandlers) => StopHandler | Promise<StopHandler>;
};
