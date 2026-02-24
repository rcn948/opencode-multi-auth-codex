import type { Plugin } from '@opencode-ai/plugin';
import { type AccountAuthType } from './types.js';
type ProviderModelConfig = Record<string, any>;
export declare function toCodexBackendUrl(originalUrl: string): string;
export declare function ensureCodexInstructions(payload: Record<string, any>): Record<string, any>;
export declare function ensureCodexPayloadCompatibility(payload: Record<string, any>): Record<string, any>;
export declare function selectAuthTypeForRequest(model: unknown, requestUrl?: string): AccountAuthType;
export declare function extractForcedAuthType(payload: Record<string, any>): AccountAuthType | null;
export declare function rewriteOpenAIModelsForRouting(models: Record<string, ProviderModelConfig>): Record<string, ProviderModelConfig>;
/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
declare const MultiAuthPlugin: Plugin;
export default MultiAuthPlugin;
//# sourceMappingURL=index.d.ts.map