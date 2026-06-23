import type { OptionNBBO, OptionPrint } from "@islandflow/types";
import { parseOptionContractId } from "@islandflow/types";

export const normalizeOptionsTapeContractId = (value: string): string => value.trim();

export const getOptionsTapePrintKey = (print: OptionPrint): string =>
  print.trace_id ? `${print.trace_id}:${print.seq}` : `${print.ts}:${print.seq}`;

export const getOptionsTapePrintCursor = (print: OptionPrint) => ({
  ts: print.ts,
  seq: print.seq
});

export const getOptionsTapeUnderlying = (
  print: Pick<OptionPrint, "option_contract_id" | "underlying_id">
): string => {
  if (print.underlying_id) {
    return print.underlying_id.toUpperCase();
  }
  const parsed = parseOptionContractId(print.option_contract_id);
  return parsed?.root.toUpperCase() ?? print.option_contract_id.split("-")[0]?.toUpperCase() ?? "";
};

const formatStrike = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number.isInteger(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

export const getOptionsTapeDte = (expiry: string, now = Date.now()): number | null => {
  const match = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const nowDate = new Date(now);
  const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const expiryDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
};

export const formatOptionsTapeExpiry = (expiry: string, now = Date.now()): string => {
  const dte = getOptionsTapeDte(expiry, now);
  if (dte === 0) {
    return "0DTE";
  }
  const match = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return expiry;
  }
  return `${Number(match[2])}/${Number(match[3])}`;
};

export const formatOptionsTapeContractLabel = (contractId: string, now = Date.now()): string => {
  const parsed = parseOptionContractId(normalizeOptionsTapeContractId(contractId));
  if (!parsed) {
    return contractId;
  }
  return `${parsed.root.toUpperCase()} ${formatOptionsTapeExpiry(parsed.expiry, now)} ${formatStrike(
    parsed.strike
  )}${parsed.right}`;
};

export const formatOptionsTapeDteLabel = (contractId: string, now = Date.now()): string => {
  const parsed = parseOptionContractId(normalizeOptionsTapeContractId(contractId));
  if (!parsed) {
    return "--";
  }
  const dte = getOptionsTapeDte(parsed.expiry, now);
  return dte === null ? "--" : dte === 0 ? "0DTE" : `${dte}D`;
};

export const formatOptionsTapeTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export const formatOptionsTapePrice = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "--";

export const formatOptionsTapeSize = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString() : "--";

export const getOptionsTapePremium = (print: Pick<OptionPrint, "notional" | "price" | "size">): number =>
  print.notional ?? print.price * print.size * 100;

export const formatOptionsTapePremium = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  if (abs < 1_000) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (abs < 1_000_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${(value / 1_000_000).toFixed(2)}M`;
};

export const formatOptionsTapePercent = (value: number | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";

export const formatOptionsTapeNbbo = (print: OptionPrint, nbbo?: OptionNBBO | null): string => {
  const bid = print.execution_nbbo_bid ?? nbbo?.bid;
  const ask = print.execution_nbbo_ask ?? nbbo?.ask;
  if (typeof bid !== "number" || typeof ask !== "number") {
    return "--";
  }
  return `${formatOptionsTapePrice(bid)} x ${formatOptionsTapePrice(ask)}`;
};

export const getOptionsTapeSide = (print: OptionPrint): string =>
  print.execution_nbbo_side ?? print.nbbo_side ?? "MISSING";
