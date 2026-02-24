import type { AccountAuthType } from './types.js';
export declare const CODEX_ORIGIN = "https://chatgpt.com";
export declare const CODEX_BACKEND_PREFIX = "/backend-api";
export declare const ROUTE_HINT_OPTION = "opencodeMultiAuthRoute";
type ProviderModelConfig = Record<string, any>;
export declare function toCodexBackendUrl(originalUrl: string): string;
export declare function extractModelName(model: unknown): string | undefined;
export declare function normalizeModel(model: unknown): string | undefined;
export declare function selectAuthTypeForRequest(model: unknown, requestUrl?: string): AccountAuthType;
export declare function extractForcedAuthType(payload: Record<string, any>): AccountAuthType | null;
export declare function stripForcedAuthType(payload: Record<string, any>): void;
export declare function rewriteOpenAIModelsForRouting(models: Record<string, ProviderModelConfig>): Record<string, ProviderModelConfig>;
export declare function ensureCodexInstructions(payload: Record<string, any>): Record<string, any>;
export declare function ensureCodexPayloadCompatibility(payload: Record<string, any>): Record<string, any>;
export {};
//# sourceMappingURL=routing.d.ts.map