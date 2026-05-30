export type AlpacaCredentials = {
  keyId: string;
  secret: string;
  legacyToken: string;
  usesLegacyBearer: boolean;
};

type AlpacaCredentialEnv = {
  ALPACA_API_KEY?: string;
  ALPACA_API_KEY_ID?: string;
  ALPACA_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
  ALPACA_SECRET_KEY?: string;
};

const normalize = (value: string | undefined): string => value?.trim() ?? "";

export const resolveAlpacaCredentials = (env: AlpacaCredentialEnv): AlpacaCredentials => {
  const legacyToken = normalize(env.ALPACA_API_KEY);
  const explicitKeyId = normalize(env.ALPACA_API_KEY_ID) || normalize(env.ALPACA_KEY_ID);
  const secret = normalize(env.ALPACA_API_SECRET_KEY) || normalize(env.ALPACA_SECRET_KEY);
  const keyId = explicitKeyId || legacyToken;
  const usesLegacyBearer = !explicitKeyId && !secret && legacyToken.length > 0;

  return {
    keyId,
    secret,
    legacyToken,
    usesLegacyBearer
  };
};

export const hasAlpacaCredentials = (credentials: AlpacaCredentials): boolean => {
  if (credentials.usesLegacyBearer) {
    return credentials.legacyToken.length > 0;
  }

  return credentials.keyId.length > 0 && credentials.secret.length > 0;
};

export const buildAlpacaAuthHeaders = (credentials: AlpacaCredentials): Record<string, string> => {
  if (credentials.usesLegacyBearer) {
    return {
      Authorization: `Bearer ${credentials.legacyToken}`
    };
  }

  return {
    "APCA-API-KEY-ID": credentials.keyId,
    "APCA-API-SECRET-KEY": credentials.secret
  };
};

export const buildAlpacaWebSocketAuthMessage = (
  credentials: AlpacaCredentials
): { action: "auth"; key: string; secret: string } => {
  if (credentials.usesLegacyBearer) {
    return {
      action: "auth",
      key: credentials.legacyToken,
      secret: ""
    };
  }

  return {
    action: "auth",
    key: credentials.keyId,
    secret: credentials.secret
  };
};
