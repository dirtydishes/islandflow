#!/usr/bin/env python3
import argparse
import datetime as dt
import inspect
import json
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay Databento option trades as JSON lines.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--schema", default="trades")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", default="")
    parser.add_argument("--symbols", default="ALL")
    parser.add_argument("--stype-in", dest="stype_in", default="raw_symbol")
    parser.add_argument("--stype-out", dest="stype_out", default="raw_symbol")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--api-key", dest="api_key", default="")
    return parser.parse_args()


def resolve_client(db_module, api_key: str):
    try:
        return db_module.Historical(api_key)
    except TypeError:
        return db_module.Historical(key=api_key)


def normalize_symbols(value: str):
    if not value or value.strip().upper() == "ALL":
        return None
    return [symbol.strip() for symbol in value.split(",") if symbol.strip()]


def parse_date(value: str | None) -> dt.date | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
        return parsed.date()
    except ValueError:
        try:
            return dt.date.fromisoformat(value)
        except ValueError:
            return None


def normalize_ts(ts_value):
    if ts_value is None:
        return None
    if isinstance(ts_value, dt.datetime):
        return int(ts_value.timestamp() * 1000)
    if isinstance(ts_value, dt.date):
        return int(dt.datetime.combine(ts_value, dt.time()).timestamp() * 1000)
    if isinstance(ts_value, (int, float)):
        if ts_value > 1_000_000_000_000_000:
            return int(ts_value / 1_000_000)
        return int(ts_value)
    return None


def stringify(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value)

def is_numeric_symbol(value: object) -> bool:
    if isinstance(value, int):
        return True
    if isinstance(value, str):
        return value.isdigit()
    return False


class SymbolResolver:
    def __init__(self, client, dataset: str, start_date: dt.date | None, end_date: dt.date | None):
        from databento.common.symbology import InstrumentMap

        self._client = client
        self._dataset = dataset
        self._start_date = start_date
        self._end_date = end_date
        self._map = InstrumentMap()
        self._pending: list[int] = []
        self._pending_set: set[int] = set()

    def queue(self, instrument_id: int) -> None:
        if instrument_id in self._pending_set:
            return
        self._pending_set.add(instrument_id)
        self._pending.append(instrument_id)

    def resolve_pending(self) -> None:
        if not self._pending:
            return
        pending = self._pending
        self._pending = []
        self._pending_set.clear()

        for i in range(0, len(pending), 2000):
            chunk = pending[i : i + 2000]
            response = self._client.symbology.resolve(
                dataset=self._dataset,
                symbols=chunk,
                stype_in="instrument_id",
                stype_out="raw_symbol",
                start_date=self._start_date or dt.date.today(),
                end_date=self._end_date,
            )
            self._map.insert_json(response)

    def lookup(self, instrument_id: int, date: dt.date) -> str | None:
        if instrument_id is None:
            return None
        return self._map.resolve(instrument_id, date)

    def pending_count(self) -> int:
        return len(self._pending)


def build_payload(record, symbol_override: str | None = None) -> dict | None:
    ts_event = getattr(record, "ts_event", None)
    price = getattr(record, "price", None)
    size = getattr(record, "size", None)
    symbol = symbol_override or (
        getattr(record, "symbol", None)
        or getattr(record, "raw_symbol", None)
        or getattr(record, "instrument_id", None)
    )

    if ts_event is None or price is None or size is None or symbol is None:
        return None

    ts_ms = normalize_ts(ts_event)
    if ts_ms is None:
        return None

    exchange = (
        getattr(record, "exchange", None)
        or getattr(record, "publisher_id", None)
        or getattr(record, "exchange_id", None)
    )
    conditions = getattr(record, "conditions", None) or getattr(record, "condition", None)
    if isinstance(conditions, str):
        conditions = [conditions]

    payload = {
        "ts": ts_ms,
        "price": float(price),
        "size": int(size),
        "symbol": stringify(symbol),
    }

    if exchange is not None:
        payload["exchange"] = stringify(exchange)
    if conditions:
        payload["conditions"] = conditions

    return payload


def emit_payload(payload: dict | None) -> None:
    if payload is None:
        return
    print(json.dumps(payload), flush=True)


def main() -> int:
    args = parse_args()

    api_key = args.api_key or os.getenv("DATABENTO_API_KEY")
    if not api_key:
        sys.stderr.write("DATABENTO_API_KEY is required.\n")
        return 1

    try:
        import databento as db
    except ImportError:
        sys.stderr.write("Missing Python package 'databento'. Install with pip.\n")
        return 1

    client = resolve_client(db, api_key)

    start_date = parse_date(args.start)
    end_date = parse_date(args.end) if args.end else None
    resolver = SymbolResolver(client, args.dataset, start_date, end_date)
    buffered: list[tuple[object, int, dt.date]] = []

    kwargs = {
        "dataset": args.dataset,
        "schema": args.schema,
        "start": args.start,
        "end": args.end or None,
        "symbols": normalize_symbols(args.symbols),
        "stype_in": args.stype_in,
        "stype_out": args.stype_out,
        "limit": args.limit or None,
    }

    signature = inspect.signature(client.timeseries.get_range)
    filtered_kwargs = {
        key: value for key, value in kwargs.items() if key in signature.parameters and value is not None
    }

    data = client.timeseries.get_range(**filtered_kwargs)

    def flush_buffer(force: bool = False) -> None:
        if not buffered:
            return

        resolver.resolve_pending()
        remaining: list[tuple[object, int, dt.date]] = []
        for record, instrument_id, date in buffered:
            mapped = resolver.lookup(instrument_id, date)
            if mapped:
                emit_payload(build_payload(record, mapped))
            elif force:
                emit_payload(build_payload(record, str(instrument_id)))
            else:
                remaining.append((record, instrument_id, date))
        buffered[:] = remaining

    def handle_record(record) -> None:
        symbol = (
            getattr(record, "symbol", None)
            or getattr(record, "raw_symbol", None)
            or getattr(record, "instrument_id", None)
        )

        ts_event = getattr(record, "ts_event", None)
        ts_ms = normalize_ts(ts_event)
        if ts_ms is None:
            return

        date = dt.datetime.utcfromtimestamp(ts_ms / 1000).date()

        if is_numeric_symbol(symbol):
            instrument_id = int(symbol)
            mapped = resolver.lookup(instrument_id, date)
            if mapped:
                emit_payload(build_payload(record, mapped))
                return

            resolver.queue(instrument_id)
            buffered.append((record, instrument_id, date))

            if resolver.pending_count() >= 200:
                flush_buffer()
            return

        emit_payload(build_payload(record))

    if hasattr(data, "replay"):
        try:
            data.replay(callback=handle_record)
        except TypeError:
            data.replay(handle_record)
        flush_buffer(force=True)
        return 0

    if hasattr(data, "__iter__"):
        for record in data:
            handle_record(record)
            if len(buffered) >= 2000:
                flush_buffer()
        flush_buffer(force=True)
        return 0

    sys.stderr.write("Unsupported Databento response type.\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
