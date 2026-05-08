import type { OptionPrintQueryFilters } from "@islandflow/storage";
import {
  OptionFlowViewSchema,
  OptionNbboSideSchema,
  OptionSecurityTypeSchema,
  OptionTypeSchema,
  type OptionFlowFilters
} from "@islandflow/types";
import { z } from "zod";

const optionSideListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  .pipe(z.array(OptionNbboSideSchema));

const optionTypeListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  .pipe(z.array(OptionTypeSchema));

const optionSecuritySchema = z.enum(["stock", "etf", "all"]);

const optionFilterQuerySchema = z.object({
  view: OptionFlowViewSchema.optional(),
  security: optionSecuritySchema.optional(),
  side: optionSideListSchema.optional(),
  type: optionTypeListSchema.optional(),
  min_notional: z.coerce.number().nonnegative().optional()
});

export type ParsedOptionPrintQuery = {
  scope: {
    underlyingIds?: string[];
    optionContractId?: string;
  };
  flowFilters: OptionFlowFilters;
  storageFilters: OptionPrintQueryFilters;
  isContractDrilldown: boolean;
};

const parseScopeList = (url: URL, ...keys: string[]): string[] | undefined => {
  const values = keys
    .flatMap((key) => url.searchParams.getAll(key))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const unique = Array.from(new Set(values));
  return unique.length > 0 ? unique : undefined;
};

export const parseOptionPrintQuery = (url: URL): ParsedOptionPrintQuery => {
  const parsed = optionFilterQuerySchema.parse({
    view: url.searchParams.get("view") ?? undefined,
    security: url.searchParams.get("security") ?? undefined,
    side: url.searchParams.get("side") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    min_notional: url.searchParams.get("min_notional") ?? undefined
  });
  const scope = {
    underlyingIds: parseScopeList(url, "underlying_id", "underlying_ids"),
    optionContractId: url.searchParams.get("option_contract_id") ?? undefined
  };
  const view = parsed.view ?? "signal";
  const security = parsed.security ?? (view === "raw" ? "all" : "stock");
  const flowFilters: OptionFlowFilters = {
    view,
    securityTypes:
      security === "all"
        ? undefined
        : ([security] as Array<z.infer<typeof OptionSecurityTypeSchema>>),
    nbboSides: parsed.side,
    optionTypes: parsed.type,
    minNotional: parsed.min_notional
  };
  const isContractDrilldown = Boolean(scope.optionContractId);
  const storageFilters: OptionPrintQueryFilters = isContractDrilldown
    ? {
        view: "raw",
        optionContractId: scope.optionContractId
      }
    : {
        view,
        security,
        minNotional: parsed.min_notional,
        nbboSides: parsed.side,
        optionTypes: parsed.type,
        underlyingIds: scope.underlyingIds,
        optionContractId: scope.optionContractId
      };

  return {
    scope,
    flowFilters,
    storageFilters,
    isContractDrilldown
  };
};
