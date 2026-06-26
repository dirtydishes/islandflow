export const EASTERN_TIME_ZONE = "America/New_York";
export const EASTERN_TIME_LABEL = "ET";

const DEFAULT_LOCALE = "en-US";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterKey = (locale: string, options: Intl.DateTimeFormatOptions): string =>
  JSON.stringify([
    locale,
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  ]);

const getFormatter = (
  options: Intl.DateTimeFormatOptions,
  locale = DEFAULT_LOCALE
): Intl.DateTimeFormat => {
  const normalizedOptions = { ...options, timeZone: EASTERN_TIME_ZONE };
  const key = formatterKey(locale, normalizedOptions);
  const cached = formatterCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, normalizedOptions);
  formatterCache.set(key, formatter);
  return formatter;
};

const isFiniteTimestamp = (ts: number): boolean => Number.isFinite(ts);

export const formatEasternDate = (
  ts: number,
  options: Intl.DateTimeFormatOptions = {},
  locale = DEFAULT_LOCALE
): string => {
  if (!isFiniteTimestamp(ts)) {
    return "--";
  }
  return getFormatter(
    {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      ...options
    },
    locale
  ).format(new Date(ts));
};

export const formatEasternTime = (
  ts: number,
  options: Intl.DateTimeFormatOptions = {},
  locale = DEFAULT_LOCALE
): string => {
  if (!isFiniteTimestamp(ts)) {
    return "--";
  }
  return getFormatter(
    {
      hour: "numeric",
      minute: "2-digit",
      ...options
    },
    locale
  ).format(new Date(ts));
};

export const formatEasternDateTime = (
  ts: number,
  options: Intl.DateTimeFormatOptions = {},
  locale = DEFAULT_LOCALE
): string => {
  if (!isFiniteTimestamp(ts)) {
    return "--";
  }
  return getFormatter(
    {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      ...options
    },
    locale
  ).format(new Date(ts));
};

export const formatEasternTimestampWithMs = (
  ts: number,
  timeOptions: Intl.DateTimeFormatOptions = {},
  dateOptions: Intl.DateTimeFormatOptions = {}
): string => {
  if (!isFiniteTimestamp(ts)) {
    return "--";
  }
  const ms = String(new Date(ts).getMilliseconds()).padStart(3, "0");
  return `${formatEasternDate(ts, dateOptions)} ${formatEasternTime(ts, timeOptions)}.${ms}`;
};

const easternDateKeyFormatter = getFormatter({
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export const getEasternDateKey = (ts: number): string => {
  if (!isFiniteTimestamp(ts)) {
    return "";
  }
  const parts = easternDateKeyFormatter.formatToParts(new Date(ts));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
};

export const isSameEasternDay = (left: number, right: number): boolean =>
  getEasternDateKey(left) === getEasternDateKey(right);
