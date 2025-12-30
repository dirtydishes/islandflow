export type ParsedContract = {
  root: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
};

const parseDashedContract = (value: string): ParsedContract | null => {
  const parts = value.split("-");
  if (parts.length < 6) {
    return null;
  }

  const rightRaw = parts.at(-1) ?? "";
  if (rightRaw !== "C" && rightRaw !== "P") {
    return null;
  }

  const strikeRaw = parts.at(-2) ?? "";
  const strike = Number(strikeRaw);
  const expiryParts = parts.slice(-5, -2);
  const expiry = expiryParts.join("-");
  const root = parts.slice(0, -5).join("-");

  if (!root || !expiry || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right: rightRaw
  };
};

const parseOccContract = (value: string): ParsedContract | null => {
  if (value.length < 15) {
    return null;
  }

  const tail = value.slice(-15);
  const root = value.slice(0, -15).trim();
  const expiryRaw = tail.slice(0, 6);
  const right = tail.slice(6, 7);
  const strikeRaw = tail.slice(7);

  if (!/^\d{6}$/.test(expiryRaw) || !/^\d{8}$/.test(strikeRaw)) {
    return null;
  }

  if (right !== "C" && right !== "P") {
    return null;
  }

  const year = 2000 + Number(expiryRaw.slice(0, 2));
  const month = Number(expiryRaw.slice(2, 4)) - 1;
  const day = Number(expiryRaw.slice(4, 6));
  const expiryDate = new Date(Date.UTC(year, month, day));
  const expiry = expiryDate.toISOString().slice(0, 10);
  const strike = Number(strikeRaw) / 1000;

  if (!root || !Number.isFinite(strike)) {
    return null;
  }

  return {
    root,
    expiry,
    strike,
    right
  };
};

export const parseContractId = (value: string | undefined): ParsedContract | null => {
  if (!value) {
    return null;
  }

  return parseDashedContract(value) ?? parseOccContract(value);
};
