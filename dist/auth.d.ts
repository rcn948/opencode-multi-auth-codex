import { type AccountCredentials } from './types.js';
interface AuthorizationFlow {
    pkce: {
        verifier: string;
        challenge: string;
    };
    state: string;
    url: string;
}
interface DeviceAuthorizationFlow {
    url: string;
    userCode: string;
    deviceAuthId: string;
    intervalMs: number;
}
export declare function createHeadlessAuthorizationFlow(): Promise<DeviceAuthorizationFlow>;
export declare function loginAccountHeadless(alias: string, flow: DeviceAuthorizationFlow): Promise<AccountCredentials>;
export declare function createAuthorizationFlow(): Promise<AuthorizationFlow>;
export declare function loginAccount(alias: string, flow?: AuthorizationFlow): Promise<AccountCredentials>;
export declare function refreshToken(alias: string): Promise<AccountCredentials | null>;
export declare function ensureValidToken(alias: string): Promise<string | null>;
export {};
//# sourceMappingURL=auth.d.ts.map