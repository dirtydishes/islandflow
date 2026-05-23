import type { OptionPrint } from "@islandflow/types";

export type ProcessOptionTradeDeps = {
  persistSignalOnly: boolean;
  persist: (print: OptionPrint) => Promise<void>;
  publishRaw: (print: OptionPrint) => Promise<void>;
  publishSignal: (print: OptionPrint) => Promise<void>;
};

export const shouldPersistOptionPrint = (print: Pick<OptionPrint, "signal_pass">, persistSignalOnly: boolean): boolean => {
  return !persistSignalOnly || print.signal_pass === true;
};

export const processOptionTrade = async (print: OptionPrint, deps: ProcessOptionTradeDeps): Promise<void> => {
  if (shouldPersistOptionPrint(print, deps.persistSignalOnly)) {
    await deps.persist(print);
  }

  await deps.publishRaw(print);

  if (print.signal_pass) {
    await deps.publishSignal(print);
  }
};
