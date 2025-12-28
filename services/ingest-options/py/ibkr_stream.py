import argparse
import json
import signal
import sys
import time
from datetime import timezone

from ib_insync import IB, Option


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream IBKR option trades as JSON lines.")
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--client-id", type=int, required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--expiry", required=True)
    parser.add_argument("--strike", type=float, required=True)
    parser.add_argument("--right", required=True)
    parser.add_argument("--exchange", required=True)
    parser.add_argument("--currency", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    ib = IB()

    def shutdown(_signal: int, _frame) -> None:
        if ib.isConnected():
            ib.disconnect()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        ib.connect(args.host, args.port, clientId=args.client_id)
    except Exception as exc:
        print(f"IBKR connection failed: {exc}", file=sys.stderr)
        return 1

    contract = Option(
        args.symbol,
        args.expiry,
        args.strike,
        args.right,
        exchange=args.exchange,
        currency=args.currency,
    )

    try:
        ib.qualifyContracts(contract)
    except Exception as exc:
        print(f"IBKR contract qualification failed: {exc}", file=sys.stderr)
        ib.disconnect()
        return 1

    ticker = ib.reqMktData(contract, "", False, False)
    last_key = None

    def on_update(updated_ticker) -> None:
        nonlocal last_key
        if updated_ticker.last is None or updated_ticker.lastSize is None:
            return

        ts = updated_ticker.time
        if ts is None:
            ts_ms = int(time.time() * 1000)
        else:
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            ts_ms = int(ts.timestamp() * 1000)

        key = (ts_ms, updated_ticker.last, updated_ticker.lastSize)
        if key == last_key:
            return
        last_key = key

        exchange = None
        if hasattr(updated_ticker, "lastExchange"):
            exchange = updated_ticker.lastExchange
        if not exchange:
            exchange = updated_ticker.exchange or "IBKR"

        payload = {
            "ts": ts_ms,
            "price": float(updated_ticker.last),
            "size": int(updated_ticker.lastSize),
            "exchange": exchange,
        }

        print(json.dumps(payload), flush=True)

    ticker.updateEvent += on_update
    ib.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
