export interface CodexAuthTokens {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id?: string;
}
export interface CodexAuthFile {
    OPENAI_API_KEY: string | null;
    tokens: CodexAuthTokens;
    last_refresh?: string;
}
export declare function getCodexAuthPath(): string;
export declare function loadCodexAuthFile(): CodexAuthFile | null;
export declare function writeCodexAuthFile(auth: CodexAuthFile): void;
export declare function decodeJwtPayload(token: string): Record<string, any> | null;
export declare function getEmailFromClaims(claims: Record<string, any> | null): string | undefined;
export declare function getAccountIdFromClaims(claims: Record<string, any> | null): string | undefined;
export declare function getExpiryFromClaims(claims: Record<string, any> | null): number | undefined;
export declare function syncCodexAuthFile(): {
    alias: string | null;
    added: boolean;
    updated: boolean;
};
export declare function getCodexAuthStatus(): {
    error: string | null;
};
export declare function writeCodexAuthForAlias(alias: string): void;
export declare function getHermesAuthPath(): string;
export declare function writeHermesCodexAuthForAlias(alias: string): {
    alias: string;
    hermesAuthPath: string;
};
//# sourceMappingURL=codex-auth.d.ts.map