import {
  OPTION_PRINT_TRACE_ID_MAX_LENGTH,
  OPTION_PRINT_TRACE_LOOKUP_MAX_IDS
} from "@islandflow/storage";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export class OptionPrintTraceLookupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionPrintTraceLookupValidationError";
  }
}

export const parseOptionPrintTraceLookupParams = (url: URL): string[] => {
  const traceIds = Array.from(
    new Set(
      url.searchParams
        .getAll("trace_id")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );

  if (traceIds.length > OPTION_PRINT_TRACE_LOOKUP_MAX_IDS) {
    throw new OptionPrintTraceLookupValidationError(
      `too many trace_id parameters; maximum is ${OPTION_PRINT_TRACE_LOOKUP_MAX_IDS}`
    );
  }

  for (const traceId of traceIds) {
    if (traceId.length > OPTION_PRINT_TRACE_ID_MAX_LENGTH) {
      throw new OptionPrintTraceLookupValidationError(
        `trace_id exceeds ${OPTION_PRINT_TRACE_ID_MAX_LENGTH} characters`
      );
    }
    if (CONTROL_CHARACTER_PATTERN.test(traceId)) {
      throw new OptionPrintTraceLookupValidationError("trace_id contains control characters");
    }
  }

  return traceIds;
};

export const getOptionPrintTraceLookupErrorStatus = (error: unknown): number =>
  error instanceof OptionPrintTraceLookupValidationError ? 400 : 503;
