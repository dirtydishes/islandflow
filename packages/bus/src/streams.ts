import {
  STREAM_ALERTS,
  STREAM_CLASSIFIER_HITS,
  STREAM_EQUITY_CANDLES,
  STREAM_EQUITY_JOINS,
  STREAM_EQUITY_PRINTS,
  STREAM_EQUITY_QUOTES,
  STREAM_FLOW_PACKETS,
  STREAM_INFERRED_DARK,
  STREAM_NEWS,
  STREAM_OPTION_NBBO,
  STREAM_OPTION_PRINTS,
  STREAM_OPTION_SIGNAL_PRINTS,
  STREAM_SMART_MONEY_EVENTS,
  SUBJECT_ALERTS,
  SUBJECT_CLASSIFIER_HITS,
  SUBJECT_EQUITY_CANDLES,
  SUBJECT_EQUITY_JOINS,
  SUBJECT_EQUITY_PRINTS,
  SUBJECT_EQUITY_QUOTES,
  SUBJECT_FLOW_PACKETS,
  SUBJECT_INFERRED_DARK,
  SUBJECT_NEWS,
  SUBJECT_OPTION_NBBO,
  SUBJECT_OPTION_PRINTS,
  SUBJECT_OPTION_SIGNAL_PRINTS,
  SUBJECT_SMART_MONEY_EVENTS
} from "./subjects";

export type StreamRetentionClass = "raw" | "derived";

export type KnownStreamDefinition = {
  name: string;
  subject: string;
  retentionClass: StreamRetentionClass;
};

export const STREAM_CATALOG: readonly KnownStreamDefinition[] = [
  { name: STREAM_OPTION_PRINTS, subject: SUBJECT_OPTION_PRINTS, retentionClass: "raw" },
  { name: STREAM_OPTION_NBBO, subject: SUBJECT_OPTION_NBBO, retentionClass: "raw" },
  { name: STREAM_EQUITY_PRINTS, subject: SUBJECT_EQUITY_PRINTS, retentionClass: "raw" },
  { name: STREAM_EQUITY_QUOTES, subject: SUBJECT_EQUITY_QUOTES, retentionClass: "raw" },
  {
    name: STREAM_OPTION_SIGNAL_PRINTS,
    subject: SUBJECT_OPTION_SIGNAL_PRINTS,
    retentionClass: "derived"
  },
  { name: STREAM_EQUITY_CANDLES, subject: SUBJECT_EQUITY_CANDLES, retentionClass: "derived" },
  { name: STREAM_EQUITY_JOINS, subject: SUBJECT_EQUITY_JOINS, retentionClass: "derived" },
  { name: STREAM_INFERRED_DARK, subject: SUBJECT_INFERRED_DARK, retentionClass: "derived" },
  { name: STREAM_FLOW_PACKETS, subject: SUBJECT_FLOW_PACKETS, retentionClass: "derived" },
  {
    name: STREAM_SMART_MONEY_EVENTS,
    subject: SUBJECT_SMART_MONEY_EVENTS,
    retentionClass: "derived"
  },
  { name: STREAM_CLASSIFIER_HITS, subject: SUBJECT_CLASSIFIER_HITS, retentionClass: "derived" },
  { name: STREAM_ALERTS, subject: SUBJECT_ALERTS, retentionClass: "derived" },
  { name: STREAM_NEWS, subject: SUBJECT_NEWS, retentionClass: "derived" }
];

const STREAM_CATALOG_BY_NAME = new Map(STREAM_CATALOG.map((definition) => [definition.name, definition]));

export const getKnownStreamDefinitions = (): readonly KnownStreamDefinition[] => {
  return STREAM_CATALOG;
};

export const getStreamDefinition = (name: string): KnownStreamDefinition => {
  const definition = STREAM_CATALOG_BY_NAME.get(name);
  if (!definition) {
    throw new Error(`Unknown stream definition: ${name}`);
  }

  return definition;
};
