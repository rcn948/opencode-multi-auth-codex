export type AccountAuthType = 'oauth' | 'api';
export interface AccountCredentials {
    alias: string;
    authType: AccountAuthType;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accountId?: string;
    expiresAt?: number;
    apiKey?: string;
    email?: string;
    lastRefresh?: string;
    lastSeenAt?: number;
    lastActiveUntil?: number;
    lastUsed?: number;
    usageCount: number;
    rateLimitedUntil?: number;
    modelUnsupportedUntil?: number;
    modelUnsupportedAt?: number;
    modelUnsupportedModel?: string;
    modelUnsupportedError?: string;
    workspaceDeactivatedUntil?: number;
    workspaceDeactivatedAt?: number;
    workspaceDeactivatedError?: string;
    authInvalid?: boolean;
    authInvalidatedAt?: number;
    rateLimits?: AccountRateLimits;
    rateLimitHistory?: RateLimitHistoryEntry[];
    limitStatus?: LimitStatus;
    limitError?: string;
    lastLimitProbeAt?: number;
    lastLimitErrorAt?: number;
    resetLockStatus?: ResetLockStatus;
    lastResetLockAttemptAt?: number;
    lastResetLockSuccessAt?: number;
    lastResetLockErrorAt?: number;
    lastResetLockWindowResetAt?: number;
    resetLockError?: string;
    tags?: string[];
    notes?: string;
    source?: 'opencode' | 'codex';
}
export type OAuthAccountCredentials = AccountCredentials & {
    authType: 'oauth';
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};
export type ApiAccountCredentials = AccountCredentials & {
    authType: 'api';
    apiKey: string;
};
export declare function isOauthAccount(account: AccountCredentials | null | undefined): account is OAuthAccountCredentials;
export declare function isApiAccount(account: AccountCredentials | null | undefined): account is ApiAccountCredentials;
export interface RateLimitWindow {
    limit?: number;
    remaining?: number;
    resetAt?: number;
    updatedAt?: number;
}
export interface AccountRateLimits {
    fiveHour?: RateLimitWindow;
    weekly?: RateLimitWindow;
}
export interface RateLimitSnapshot {
    remaining?: number;
    limit?: number;
    resetAt?: number;
}
export interface RateLimitHistoryEntry {
    at: number;
    fiveHour?: RateLimitSnapshot;
    weekly?: RateLimitSnapshot;
}
export type LimitStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'stopped';
export type ResetLockStatus = 'idle' | 'pending' | 'probing' | 'anchoring' | 'anchored' | 'error';
export interface AccountStore {
    accounts: Record<string, AccountCredentials>;
    activeAlias: string | null;
    rotationIndex: number;
    lastRotation: number;
}
export interface OpenAIModel {
    id: string;
    object: string;
    created: number;
    owned_by: string;
}
export interface PluginConfig {
    rotationStrategy: 'round-robin' | 'least-used' | 'random';
    autoRefreshTokens: boolean;
    rateLimitCooldownMs: number;
    modelUnsupportedCooldownMs: number;
    workspaceDeactivatedCooldownMs: number;
    modelFilter: RegExp;
}
export interface ProviderModel {
    name: string;
    limit: {
        context: number;
        output: number;
    };
    modalities: {
        input: string[];
        output: string[];
    };
    options: {
        reasoningEffort: string;
        reasoningSummary: string;
        textVerbosity: string;
        include: string[];
        store: boolean;
    };
}
export declare const DEFAULT_CONFIG: PluginConfig;
//# sourceMappingURL=types.d.ts.map