import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type IbkrOptionsAdapterConfig = {
  host: string;
  port: number;
  clientId: number;
};

export const createIbkrOptionsAdapter = (
  config: IbkrOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "ibkr",
    start: (_handlers: OptionIngestHandlers) => {
      throw new Error(
        `IBKR adapter not implemented. Requested ${config.host}:${config.port} clientId=${config.clientId}.`
      );
    }
  };
};
