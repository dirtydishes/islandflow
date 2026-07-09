const ALERT_CONTEXT_REF_LABELS: Array<[prefix: string, label: string]> = [
  ["option-nbbo:", "Option NBBO"],
  ["equity-quote:", "Equity quote"],
  ["equity-print:", "Equity print"],
  ["news-story:", "News story"],
  ["event-calendar:", "Event context"],
  ["synthetic-label:", "Synthetic label"],
  ["external-context:", "External context"]
];

export const isAlertFlowPacketRef = (ref: string): boolean => ref.startsWith("flowpacket:");

export const isAlertOptionNbboRef = (ref: string): boolean => ref.startsWith("option-nbbo:");

export const getAlertContextRefLabel = (ref: string): string | null =>
  ALERT_CONTEXT_REF_LABELS.find(([prefix]) => ref.startsWith(prefix))?.[1] ?? null;

export const isAlertContextRef = (ref: string): boolean => getAlertContextRefLabel(ref) !== null;

export const isAlertOptionPrintRef = (ref: string): boolean =>
  !isAlertFlowPacketRef(ref) &&
  !isAlertContextRef(ref) &&
  (!ref.includes(":") || ref.startsWith("print:"));
