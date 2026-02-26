export const CODEX_ORIGIN = 'https://chatgpt.com';
export const CODEX_BACKEND_PREFIX = '/backend-api';
export const ROUTE_HINT_OPTION = 'opencodeMultiAuthRoute';
function contentToText(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (!part)
                return '';
            if (typeof part === 'string')
                return part;
            if (typeof part === 'object') {
                const obj = part;
                if (typeof obj.text === 'string')
                    return obj.text;
                if (typeof obj.content === 'string')
                    return obj.content;
            }
            return '';
        })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}
function extractPathAndSearch(url) {
    try {
        const u = new URL(url);
        return `${u.pathname}${u.search}`;
    }
    catch {
        // best-effort fallback
    }
    const trimmed = String(url || '').trim();
    if (trimmed.startsWith('/'))
        return trimmed;
    const firstSlash = trimmed.indexOf('/');
    if (firstSlash >= 0)
        return trimmed.slice(firstSlash);
    return trimmed;
}
export function toCodexBackendUrl(originalUrl) {
    const pathAndSearch = extractPathAndSearch(originalUrl);
    const [pathname, search = ''] = pathAndSearch.split('?');
    let mappedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    if (mappedPath === '/v1/responses') {
        mappedPath = '/codex/responses';
    }
    else if (mappedPath === '/responses') {
        mappedPath = '/codex/responses';
    }
    else if (mappedPath === '/v1/chat/completions') {
        mappedPath = '/codex/chat/completions';
    }
    else if (mappedPath === '/chat/completions') {
        mappedPath = '/codex/chat/completions';
    }
    if (!mappedPath.startsWith(`${CODEX_BACKEND_PREFIX}/`)) {
        mappedPath = `${CODEX_BACKEND_PREFIX}${mappedPath}`;
    }
    const mapped = search ? `${mappedPath}?${search}` : mappedPath;
    return new URL(mapped, CODEX_ORIGIN).toString();
}
export function extractModelName(model) {
    if (typeof model === 'string' && model.trim())
        return model;
    if (!model || typeof model !== 'object')
        return undefined;
    const candidate = model;
    if (typeof candidate.id === 'string' && candidate.id.trim())
        return candidate.id;
    if (typeof candidate.modelID === 'string' && candidate.modelID.trim())
        return candidate.modelID;
    if (typeof candidate.model === 'string' && candidate.model.trim())
        return candidate.model;
    if (typeof candidate.name === 'string' && candidate.name.trim())
        return candidate.name;
    if (candidate.model && typeof candidate.model === 'object') {
        const nested = candidate.model;
        if (typeof nested.id === 'string' && nested.id.trim())
            return nested.id;
        if (typeof nested.modelID === 'string' && nested.modelID.trim())
            return nested.modelID;
        if (typeof nested.model === 'string' && nested.model.trim())
            return nested.model;
        if (typeof nested.name === 'string' && nested.name.trim())
            return nested.name;
    }
    return undefined;
}
export function normalizeModel(model) {
    const raw = extractModelName(model);
    if (!raw)
        return undefined;
    const modelId = raw.includes('/') ? raw.split('/').pop() : raw;
    const baseModel = modelId.replace(/-(?:none|low|medium|high|xhigh)$/, '');
    const preferLatestRaw = process.env.OPENCODE_MULTI_AUTH_PREFER_CODEX_LATEST;
    const preferLatest = preferLatestRaw !== '0' && preferLatestRaw !== 'false';
    if (preferLatest && (baseModel === 'gpt-5.2-codex' || baseModel === 'gpt-5-codex')) {
        const latestModel = (process.env.OPENCODE_MULTI_AUTH_CODEX_LATEST_MODEL || 'gpt-5.3-codex').trim();
        if (process.env.OPENCODE_MULTI_AUTH_DEBUG === '1') {
            console.log(`[multi-auth] model map: ${baseModel} -> ${latestModel}`);
        }
        return latestModel;
    }
    return baseModel;
}
export function selectAuthTypeForRequest(model, requestUrl) {
    const raw = extractModelName(model);
    const modelId = raw?.includes('/') ? raw.split('/').pop() : raw;
    const baseModel = modelId?.replace(/-(?:none|low|medium|high|xhigh)$/, '') || '';
    if (baseModel.includes('codex'))
        return 'oauth';
    if (requestUrl && requestUrl.includes('/codex/'))
        return 'oauth';
    return 'api';
}
function resolveRouteHint(value) {
    if (value === 'oauth' || value === 'api')
        return value;
    return null;
}
export function extractForcedAuthType(payload) {
    return (resolveRouteHint(payload?.[ROUTE_HINT_OPTION]) ||
        resolveRouteHint(payload?.opencode_multi_auth_route) ||
        resolveRouteHint(payload?._opencode_multi_auth_route));
}
export function stripForcedAuthType(payload) {
    delete payload[ROUTE_HINT_OPTION];
    delete payload.opencode_multi_auth_route;
    delete payload._opencode_multi_auth_route;
}
function stripAuthLabel(name) {
    return name.replace(/\s*\((oauth|api)\)$/i, '').trim();
}
function dualRouteModelIDs() {
    const raw = (process.env.OPENCODE_MULTI_AUTH_DUAL_ROUTE_MODELS || 'gpt-5,gpt-5.1,gpt-5.2').trim();
    const ids = raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    return new Set(ids);
}
function shouldDualRouteModel(apiID) {
    if (!apiID)
        return false;
    const id = apiID.toLowerCase();
    if (id.includes('codex'))
        return false;
    if (id.includes('-chat-latest'))
        return false;
    return dualRouteModelIDs().has(id);
}
function providerModelID(key, model) {
    return typeof model.id === 'string' && model.id.trim() ? model.id : key;
}
function withRouteOption(model, route) {
    const options = model.options && typeof model.options === 'object' ? model.options : {};
    return {
        ...options,
        [ROUTE_HINT_OPTION]: route
    };
}
function withLabeledRoute(model, apiID, name, route) {
    return {
        ...model,
        id: apiID,
        name,
        options: withRouteOption(model, route)
    };
}
function modelRoute(model) {
    return resolveRouteHint(model?.options?.[ROUTE_HINT_OPTION]);
}
function isDuplicateDisplay(out, value) {
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    if (!name)
        return false;
    const route = modelRoute(value);
    return Object.values(out).some((existing) => {
        const existingName = typeof existing?.name === 'string' ? existing.name.trim() : '';
        if (!existingName)
            return false;
        if (existingName !== name)
            return false;
        return modelRoute(existing) === route;
    });
}
function addModel(out, key, value) {
    if (isDuplicateDisplay(out, value))
        return;
    if (!out[key]) {
        out[key] = value;
        return;
    }
    let index = 1;
    let candidate = `${key}-${index}`;
    while (out[candidate]) {
        index += 1;
        candidate = `${key}-${index}`;
    }
    out[candidate] = value;
}
export function rewriteOpenAIModelsForRouting(models) {
    const out = {};
    const expandedModelIDs = new Set();
    for (const [key, rawModel] of Object.entries(models)) {
        const model = rawModel && typeof rawModel === 'object' ? rawModel : {};
        const apiID = providerModelID(key, model);
        const cleanName = stripAuthLabel(typeof model.name === 'string' ? model.name : apiID);
        if (apiID.toLowerCase().includes('codex')) {
            if (expandedModelIDs.has(apiID))
                continue;
            expandedModelIDs.add(apiID);
            addModel(out, `${apiID}-api`, withLabeledRoute(model, apiID, `${cleanName} (API)`, 'api'));
            addModel(out, `${apiID}-oauth`, withLabeledRoute(model, apiID, `${cleanName} (OAuth)`, 'oauth'));
            continue;
        }
        if (shouldDualRouteModel(apiID)) {
            if (expandedModelIDs.has(apiID))
                continue;
            expandedModelIDs.add(apiID);
            addModel(out, `${apiID}-api`, withLabeledRoute(model, apiID, `${cleanName} (API)`, 'api'));
            addModel(out, `${apiID}-oauth`, withLabeledRoute(model, apiID, `${cleanName} (OAuth)`, 'oauth'));
            continue;
        }
        addModel(out, key, withLabeledRoute(model, apiID, `${cleanName} (API)`, 'api'));
    }
    return out;
}
export function ensureCodexInstructions(payload) {
    const existing = typeof payload.instructions === 'string' ? payload.instructions.trim() : '';
    if (existing)
        return payload;
    if (Array.isArray(payload.input)) {
        const extracted = [];
        const remaining = [];
        for (const item of payload.input) {
            const role = item?.role;
            if (role === 'system' || role === 'developer') {
                const text = contentToText(item?.content);
                if (text.trim())
                    extracted.push(text.trim());
                continue;
            }
            remaining.push(item);
        }
        if (extracted.length > 0) {
            payload.instructions = extracted.join('\n\n');
            payload.input = remaining;
            return payload;
        }
    }
    if (Array.isArray(payload.messages)) {
        const extracted = [];
        const input = [];
        for (const msg of payload.messages) {
            const role = msg?.role;
            if (role === 'system' || role === 'developer') {
                const text = contentToText(msg?.content);
                if (text.trim())
                    extracted.push(text.trim());
                continue;
            }
            if (role === 'user' || role === 'assistant') {
                input.push({ role, content: msg?.content });
            }
        }
        if (input.length > 0 && !payload.input) {
            payload.input = input;
        }
        delete payload.messages;
        if (extracted.length > 0) {
            payload.instructions = extracted.join('\n\n');
            return payload;
        }
    }
    payload.instructions = 'You are a helpful coding assistant.';
    return payload;
}
export function ensureCodexPayloadCompatibility(payload) {
    if (typeof payload.max_output_tokens === 'number') {
        const value = payload.max_output_tokens;
        delete payload.max_output_tokens;
        if (payload.max_tokens === undefined) {
            payload.max_tokens = value;
        }
    }
    else if ('max_output_tokens' in payload) {
        delete payload.max_output_tokens;
    }
    delete payload.service_tier;
    delete payload.safety_identifier;
    return payload;
}
//# sourceMappingURL=routing.js.map