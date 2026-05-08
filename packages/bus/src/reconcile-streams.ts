import { runReconcileStreamsCommand } from "./jetstream";

const exitCode = await runReconcileStreamsCommand(process.argv.slice(2));
process.exit(exitCode);
