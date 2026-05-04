export type EventCalendarKind = "earnings" | "dividend" | "corporate_action" | "m_and_a" | "news" | "other";

export type EventCalendarEntry = {
  underlying_id: string;
  event_ts: number;
  event_kind: EventCalendarKind;
  announced_ts: number;
  source?: string;
  source_event_id?: string;
};

export type EventCalendarMatch = EventCalendarEntry & {
  days_to_event: number;
};

export type EventCalendarProvider = {
  findNextEvent(underlyingId: string, asOfTs: number): EventCalendarMatch | null;
};

const MS_PER_DAY = 86_400_000;

const EVENT_KINDS = new Set<EventCalendarKind>([
  "earnings",
  "dividend",
  "corporate_action",
  "m_and_a",
  "news",
  "other"
]);

const normalizeUnderlying = (underlyingId: string): string => underlyingId.trim().toUpperCase();

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
};

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export const parseEventCalendarEntries = (value: unknown): EventCalendarEntry[] => {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap((row): EventCalendarEntry[] => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const record = row as Record<string, unknown>;
    const underlying = asString(record.underlying_id ?? record.underlying ?? record.symbol);
    const eventTs = asNumber(record.event_ts ?? record.event_time ?? record.event_date);
    const announcedTs = asNumber(record.announced_ts ?? record.available_ts ?? record.as_of_ts ?? record.created_ts) ?? 0;
    const rawKind = asString(record.event_kind ?? record.kind ?? record.type) ?? "other";
    const eventKind = EVENT_KINDS.has(rawKind as EventCalendarKind) ? (rawKind as EventCalendarKind) : "other";

    if (!underlying || eventTs === null || eventTs < 0 || announcedTs < 0) {
      return [];
    }

    return [
      {
        underlying_id: normalizeUnderlying(underlying),
        event_ts: Math.trunc(eventTs),
        event_kind: eventKind,
        announced_ts: Math.trunc(announcedTs),
        ...(asString(record.source) ? { source: asString(record.source) ?? undefined } : {}),
        ...(asString(record.source_event_id ?? record.id)
          ? { source_event_id: asString(record.source_event_id ?? record.id) ?? undefined }
          : {})
      }
    ];
  });
};

export const createStaticEventCalendarProvider = (entries: EventCalendarEntry[]): EventCalendarProvider => {
  const byUnderlying = new Map<string, EventCalendarEntry[]>();
  for (const entry of entries) {
    const key = normalizeUnderlying(entry.underlying_id);
    const normalized = { ...entry, underlying_id: key };
    const bucket = byUnderlying.get(key) ?? [];
    bucket.push(normalized);
    byUnderlying.set(key, bucket);
  }

  for (const bucket of byUnderlying.values()) {
    bucket.sort((a, b) => a.event_ts - b.event_ts || a.announced_ts - b.announced_ts);
  }

  return {
    findNextEvent(underlyingId, asOfTs) {
      const key = normalizeUnderlying(underlyingId);
      if (!key || !Number.isFinite(asOfTs)) {
        return null;
      }

      const bucket = byUnderlying.get(key) ?? [];
      const entry = bucket.find((candidate) => candidate.announced_ts <= asOfTs && candidate.event_ts >= asOfTs);
      return entry ? { ...entry, days_to_event: (entry.event_ts - asOfTs) / MS_PER_DAY } : null;
    }
  };
};

export const createEmptyEventCalendarProvider = (): EventCalendarProvider => createStaticEventCalendarProvider([]);

export const loadEventCalendarProviderFromFile = async (path: string): Promise<EventCalendarProvider> => {
  const text = await Bun.file(path).text();
  return createStaticEventCalendarProvider(parseEventCalendarEntries(JSON.parse(text)));
};
