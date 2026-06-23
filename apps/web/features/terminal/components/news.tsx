"use client";

import type { NewsStory } from "@islandflow/types";

import { getNewsWireStatus } from "../../news-wire/format";
import type { TerminalState } from "../state";

export { getNewsWireStatus };

export const openNewsStory = (state: TerminalState, story: NewsStory): void => {
  state.setSelectedNewsStory(null);
  state.setSelectedAlert(null);
  state.setSelectedClassifierHit(null);
  state.setSelectedSmartFlowProjection(null);
  state.setSelectedSmartMoneyEvent(null);
  state.setSelectedDarkEvent(null);
  state.setSelectedNewsStory(story);
};
