import type { AccountCredentials, AccountRateLimits } from './types.js';
export interface ProbeResult {
    rateLimits?: AccountRateLimits;
    eventTs?: number;
    sourceFile?: string;
    error?: string;
    authInvalid?: boolean;
    usageLimited?: boolean;
    usageLimitResetAt?: number;
}
export declare function isAuthInvalidErrorMessage(message: string | undefined): boolean;
export declare function isUsageLimitErrorMessage(message: string | undefined): boolean;
export declare function parseUsageLimitResetAt(message: string | undefined): number | undefined;
export declare function resolveCodexExecutable(pathValue?: string): {
    command: string;
    pathEnv: string;
};
export declare function probeRateLimitsForAccount(account: AccountCredentials): Promise<ProbeResult>;
export declare function getProbeHomeRoot(): string;
//# sourceMappingURL=probe-limits.d.ts.map