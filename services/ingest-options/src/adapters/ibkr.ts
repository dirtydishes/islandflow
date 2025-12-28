import type { OptionIngestAdapter, OptionIngestHandlers } from "./types";

type IbkrOptionsAdapterConfig = {
  host: string;
  port: number;
  clientId: number;
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  exchange: string;
  currency: string;
  pythonBin: string;
};

type IbkrTradeMessage = {
  ts: number;
  price: number;
  size: number;
  exchange?: string;
};

const formatExpiry = (expiry: string): string => {
  if (/^\d{8}$/.test(expiry)) {
    return `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}`;
  }

  return expiry;
};

const readLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        onLine(trimmed);
      }
    }
  }

  if (buffer.trim().length > 0) {
    onLine(buffer.trim());
  }
};

export const createIbkrOptionsAdapter = (
  config: IbkrOptionsAdapterConfig
): OptionIngestAdapter => {
  return {
    name: "ibkr",
    start: (handlers: OptionIngestHandlers) => {
      const scriptPath = new URL("../../py/ibkr_stream.py", import.meta.url).pathname;
      const args = [
        config.pythonBin,
        scriptPath,
        "--host",
        config.host,
        "--port",
        String(config.port),
        "--client-id",
        String(config.clientId),
        "--symbol",
        config.symbol,
        "--expiry",
        config.expiry,
        "--strike",
        String(config.strike),
        "--right",
        config.right,
        "--exchange",
        config.exchange,
        "--currency",
        config.currency
      ];

      const child = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "inherit"
      });

      if (!child.stdout) {
        throw new Error("IBKR adapter failed to attach stdout.");
      }

      let seq = 0;
      const contractId = `${config.symbol}-${formatExpiry(config.expiry)}-${config.strike}-${config.right}`;

      const handleLine = (line: string) => {
        try {
          const payload = JSON.parse(line) as IbkrTradeMessage;
          if (!payload || typeof payload.ts !== "number") {
            return;
          }

          const sourceTs = Number.isFinite(payload.ts) ? payload.ts : Date.now();
          const ingestTs = Date.now();
          seq += 1;

          void handlers.onTrade({
            source_ts: sourceTs,
            ingest_ts: ingestTs,
            seq,
            trace_id: `ibkr-${seq}`,
            ts: sourceTs,
            option_contract_id: contractId,
            price: payload.price,
            size: payload.size,
            exchange: payload.exchange ?? "IBKR"
          });
        } catch {
          // Ignore malformed lines to keep stream alive.
        }
      };

      void readLines(child.stdout, handleLine);

      const stop = () => {
        child.kill();
      };

      return stop;
    }
  };
};
