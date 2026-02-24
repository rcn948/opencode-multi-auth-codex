export function isOauthAccount(account) {
    return Boolean(account &&
        account.authType === 'oauth' &&
        typeof account.accessToken === 'string' &&
        typeof account.refreshToken === 'string' &&
        typeof account.expiresAt === 'number');
}
export function isApiAccount(account) {
    return Boolean(account &&
        account.authType === 'api' &&
        typeof account.apiKey === 'string' &&
        account.apiKey.length > 0);
}
export const DEFAULT_CONFIG = {
    rotationStrategy: 'round-robin',
    autoRefreshTokens: true,
    rateLimitCooldownMs: 5 * 60 * 1000, // 5 minutes
    modelUnsupportedCooldownMs: 30 * 60 * 1000, // 30 minutes
    workspaceDeactivatedCooldownMs: 30 * 60 * 1000, // 30 minutes
    modelFilter: /^gpt-5/
};
//# sourceMappingURL=types.js.map