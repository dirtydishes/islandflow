import type {
  DurableTapeBooleanFeatureKey,
  DurableTapeFeatureInput,
  DurableTapeResolvedFeatures,
  DurableTapeTemplateId
} from "./types";

export const DURABLE_TAPE_BOOLEAN_FEATURE_KEYS = [
  "liveHotHead",
  "clickhouseHistory",
  "scrollGate",
  "scrollHold",
  "jumpToLive",
  "newItemCount",
  "hoverDetails",
  "keyboardInspect",
  "responsiveTemplates",
  "rowTinting",
  "settingsGear",
  "noHorizontalScroll"
] as const satisfies readonly DurableTapeBooleanFeatureKey[];

export const DURABLE_TAPE_DEFAULT_FEATURES = [
  "liveHotHead",
  "clickhouseHistory",
  "scrollGate",
  "scrollHold",
  "jumpToLive",
  "newItemCount",
  "hoverDetails",
  "keyboardInspect",
  "responsiveTemplates",
  "rowTinting",
  "settingsGear",
  "noHorizontalScroll"
] as const satisfies readonly DurableTapeBooleanFeatureKey[];

const isBooleanFeatureKey = (value: string): value is DurableTapeBooleanFeatureKey => {
  return (DURABLE_TAPE_BOOLEAN_FEATURE_KEYS as readonly string[]).includes(value);
};

const createEmptyFeatureState = (): DurableTapeResolvedFeatures => {
  return {
    liveHotHead: false,
    clickhouseHistory: false,
    scrollGate: false,
    scrollHold: false,
    jumpToLive: false,
    newItemCount: false,
    hoverDetails: false,
    keyboardInspect: false,
    responsiveTemplates: false,
    rowTinting: false,
    settingsGear: false,
    noHorizontalScroll: false,
    template: "auto"
  };
};

const applyFeature = (
  state: DurableTapeResolvedFeatures,
  key: DurableTapeBooleanFeatureKey,
  enabled = true
) => {
  state[key] = enabled;
};

export const resolveDurableTapeFeatures = (
  inputs: readonly DurableTapeFeatureInput[] = ["default"]
): DurableTapeResolvedFeatures => {
  const resolved = createEmptyFeatureState();

  for (const input of inputs) {
    if (input === "default") {
      for (const feature of DURABLE_TAPE_DEFAULT_FEATURES) {
        applyFeature(resolved, feature, true);
      }
      continue;
    }

    if (typeof input === "string") {
      if (!isBooleanFeatureKey(input)) {
        throw new Error(`Unknown durable tape feature: ${input}`);
      }
      applyFeature(resolved, input, true);
      continue;
    }

    if (input.key === "template") {
      if (input.enabled === false) {
        resolved.template = "auto";
      } else {
        resolved.template = input.value;
      }
      continue;
    }

    applyFeature(resolved, input.key, input.enabled ?? true);
  }

  return resolved;
};

export const resolveDurableTapeComponentFeatures = ({
  features,
  template
}: {
  features?: readonly DurableTapeFeatureInput[];
  template?: DurableTapeTemplateId | "auto";
}): DurableTapeResolvedFeatures => {
  return resolveDurableTapeFeatures([
    ...(features ?? ["default"]),
    ...(template ? ([{ key: "template", value: template }] as const) : [])
  ]);
};
