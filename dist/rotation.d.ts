import { type AccountAuthType, type AccountCredentials, type PluginConfig } from './types.js';
export interface RotationResult {
    account: AccountCredentials;
    credential: string;
    authType: AccountAuthType;
}
export declare function getNextAccount(config: Pick<PluginConfig, 'rotationStrategy'>, options?: {
    authType?: AccountAuthType;
    model?: string;
}): Promise<RotationResult | null>;
export declare function markRateLimited(alias: string, cooldownMs: number): void;
export declare function clearRateLimit(alias: string): void;
export declare function markModelUnsupported(alias: string, cooldownMs: number, info?: {
    model?: string;
    error?: string;
}): void;
export declare function clearModelUnsupported(alias: string): void;
export declare function markWorkspaceDeactivated(alias: string, cooldownMs: number, info?: {
    error?: string;
}): void;
export declare function clearWorkspaceDeactivated(alias: string): void;
export declare function markAuthInvalid(alias: string): void;
export declare function clearAuthInvalid(alias: string): void;
//# sourceMappingURL=rotation.d.ts.map