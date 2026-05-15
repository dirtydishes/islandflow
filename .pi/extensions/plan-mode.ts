import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const PLAN_MODE_PROMPT = `PLAN MODE IS ACTIVE.

You must not modify code, configuration, tests, documentation, project files, or external files. Do not use write or edit tools. Do not run shell commands that create, modify, delete, move, format, install, commit, push, or otherwise mutate files, dependencies, services, or repository state.

You may inspect files and run read-only discovery commands. Produce a concise implementation plan, include risks and validation steps, then ask the user whether they want to proceed with implementation. If the user asks to save the plan, create only a plan document under docs/plans/ after explicitly confirming that saving the plan is allowed.`;

let planMode = false;

function looksMutatingShell(command: string): boolean {
  const normalized = command.toLowerCase();
  const mutatingPatterns = [
    /(^|[;&|()\s])(>|>>|tee\b)/,
    /(^|[;&|()\s])(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate)\b/,
    /(^|[;&|()\s])(git\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|clean|tag|branch)|bd\s+(create|update|close|reopen|dolt\s+push))\b/,
    /(^|[;&|()\s])(bun|npm|pnpm|yarn|npx)\s+(install|add|remove|update|upgrade|dedupe|run\s+(build|dev|format|lint:fix))\b/,
    /(^|[;&|()\s])(python|python3|node|ruby|perl)\b.*\b(-w|writefile|appendfile|unlink|rmdir|mkdir|rename)\b/,
    /(^|[;&|()\s])(docker|docker-compose)\s+(run|compose\s+up|up|down|rm|rmi|build|push|pull)\b/,
  ];

  return mutatingPatterns.some((pattern) => pattern.test(normalized));
}

export default function planModeExtension(pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Activate plan mode. Use '/plan off' to return to implementation mode.",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();

      if (["off", "disable", "disabled", "false", "0"].includes(command)) {
        planMode = false;
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode disabled. Implementation tools are available again.", "info");
        return;
      }

      planMode = true;
      ctx.ui.setStatus("plan-mode", "PLAN");
      ctx.ui.notify("Plan mode enabled. File mutation tools and mutating shell commands are blocked.", "success");
    },
  });

  pi.registerCommand("implement", {
    description: "Disable plan mode and return to implementation mode.",
    handler: async (_args, ctx) => {
      planMode = false;
      ctx.ui.setStatus("plan-mode", undefined);
      ctx.ui.notify("Plan mode disabled. Implementation mode is active.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (planMode) ctx.ui.setStatus("plan-mode", "PLAN");
  });

  pi.on("before_agent_start", async (event) => {
    if (!planMode) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_PROMPT}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (!planMode) return;

    if (event.toolName === "write" || event.toolName === "edit") {
      return {
        block: true,
        reason: "Plan mode is active. Use /plan off or /implement before modifying files.",
      };
    }

    if (isToolCallEventType("bash", event) && looksMutatingShell(event.input.command ?? "")) {
      return {
        block: true,
        reason: "Plan mode is active. Mutating shell commands are blocked. Use /plan off or /implement to proceed.",
      };
    }
  });
}
