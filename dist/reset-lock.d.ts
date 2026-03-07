import { type ProbeResult } from './probe-limits.js';
import { type AccountCredentials, type AccountStore } from './types.js';
export interface ResetLockRuntimeState {
    enabled: boolean;
    running: boolean;
    currentAlias?: string;
    lastRunAt?: number;
    lastSuccessAt?: number;
    lastAnchoredAlias?: string;
    lastError?: string;
}
export interface ResetLockDeps {
    loadStore: () => AccountStore;
    updateAccount: (alias: string, updates: Partial<AccountCredentials>) => AccountStore;
    writeCodexAuthForAlias: (alias: string) => void;
    probeRateLimitsForAccount: (account: AccountCredentials) => Promise<ProbeResult>;
    recommendAccount: (accounts: AccountCredentials[]) => {
        alias: string | null;
    };
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    logInfo: (message: string) => void;
    logError: (message: string) => void;
}
export declare function isResetLockEnabled(): boolean;
export declare function getResetLockIntervalMs(): number;
export declare function getResetLockState(): ResetLockRuntimeState;
export declare function __resetResetLockStateForTests(): void;
export declare function runResetLockPass(customDeps?: Partial<ResetLockDeps>): Promise<ResetLockRuntimeState>;
//# sourceMappingURL=reset-lock.d.ts.map