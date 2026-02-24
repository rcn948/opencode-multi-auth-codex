import type { Plugin } from '@opencode-ai/plugin';
import { type AccountAuthType } from './types.js';
export declare function selectAuthTypeForRequest(model: string | undefined, requestUrl?: string): AccountAuthType;
/**
 * Multi-account OAuth plugin for OpenCode
 *
 * Rotates between multiple ChatGPT Plus/Pro accounts for rate limit resilience.
 */
declare const MultiAuthPlugin: Plugin;
export default MultiAuthPlugin;
//# sourceMappingURL=index.d.ts.map