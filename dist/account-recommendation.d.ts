import type { AccountCredentials, RateLimitWindow } from './types.js';
export declare function remainingPercent(window?: RateLimitWindow): number | null;
export declare function authInvalidRetryMs(): number;
export declare function formatDurationShort(ms: number): string;
export declare function authState(account: AccountCredentials, now: number): {
    eligible: boolean;
    retrying: boolean;
    reason?: string;
};
export declare function blockReason(account: AccountCredentials, now: number): string | null;
export declare function oauthRecommendPriority(account: AccountCredentials): {
    bucket: number;
    resetAt: number;
    reason: string;
};
export type RecommendationResult = {
    alias: string | null;
    reason?: string;
    skippedReasons: Record<string, string>;
};
export declare function recommendAccount(accounts: AccountCredentials[]): RecommendationResult;
//# sourceMappingURL=account-recommendation.d.ts.map