"use client";

import {
  type OptionsSmartFlowTriageDetail,
  OptionsSmartFlowTriageDetailSchema
} from "@islandflow/types";

import { readErrorDetail } from "../terminal/transport";
import { buildOptionsTapeApiUrl } from "./source";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OptionsTapeSmartFlowDetailRequest = {
  optionTraceId: string;
  projectionTraceId?: string;
  packetId?: string;
  optionContractId?: string;
  packetLimit?: number;
  contractLimit?: number;
};

export type OptionsTapeSmartFlowDetailLoadOptions = {
  apiBaseUrl?: string;
  fetcher?: Fetcher;
};

const appendOptionalParam = (url: URL, key: string, value: string | undefined): void => {
  const trimmed = value?.trim();
  if (trimmed) {
    url.searchParams.set(key, trimmed);
  }
};

export const buildOptionsTapeSmartFlowDetailUrl = (
  request: OptionsTapeSmartFlowDetailRequest,
  apiBaseUrl?: string
): string => {
  const url = new URL(buildOptionsTapeApiUrl("/options/smart-flow-detail", apiBaseUrl));
  url.searchParams.set("option_trace_id", request.optionTraceId);
  appendOptionalParam(url, "projection_trace_id", request.projectionTraceId);
  appendOptionalParam(url, "packet_id", request.packetId);
  appendOptionalParam(url, "option_contract_id", request.optionContractId);
  if (request.packetLimit) {
    url.searchParams.set("packet_limit", String(request.packetLimit));
  }
  if (request.contractLimit) {
    url.searchParams.set("contract_limit", String(request.contractLimit));
  }
  return url.toString();
};

export const loadOptionsTapeSmartFlowDetail = async (
  request: OptionsTapeSmartFlowDetailRequest,
  options: OptionsTapeSmartFlowDetailLoadOptions = {}
): Promise<OptionsSmartFlowTriageDetail> => {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(buildOptionsTapeSmartFlowDetailUrl(request, options.apiBaseUrl));
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  const payload = (await response.json()) as { data?: unknown };
  return OptionsSmartFlowTriageDetailSchema.parse(payload.data);
};
