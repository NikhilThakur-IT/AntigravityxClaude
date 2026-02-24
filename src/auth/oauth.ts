/**
 * OAuth client implementation.
 * Handles authorization URL generation, code-for-token exchange,
 * and user profile retrieval across multiple providers.
 */

import crypto from "crypto";
import {
    OAuthConfig,
    OAuthProvider,
    TokenPair,
    User,
    AuthResult,
    OAuthCallbackParams,
} from "../types/auth";

// ── Provider endpoint registry ──────────────────────────────────────────

interface ProviderEndpoints {
    authorize: string;
    token: string;
    userInfo: string;
}

const ENDPOINTS: Record<OAuthProvider, ProviderEndpoints> = {
    github: {
        authorize: "https://github.com/login/oauth/authorize",
        token: "https://github.com/login/oauth/access_token",
        userInfo: "https://api.github.com/user",
    },
    google: {
        authorize: "https://accounts.google.com/o/oauth2/v2/auth",
        token: "https://oauth2.googleapis.com/token",
        userInfo: "https://www.googleapis.com/oauth2/v2/userinfo",
    },
    microsoft: {
        authorize:
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        userInfo: "https://graph.microsoft.com/v1.0/me",
    },
};

// ── State management (CSRF protection) ──────────────────────────────────

const pendingStates = new Map<string, { provider: OAuthProvider; expiresAt: number }>();

function generateState(provider: OAuthProvider): string {
    const state = crypto.randomBytes(32).toString("hex");
    pendingStates.set(state, {
        provider,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    });
    return state;
}

function validateState(state: string): OAuthProvider | null {
    const entry = pendingStates.get(state);
    if (!entry) return null;
    pendingStates.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry.provider;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Build the authorization URL the user should be redirected to.
 */
export function getAuthorizationUrl(config: OAuthConfig): string {
    const { provider, clientId, redirectUri, scopes } = config;
    const endpoints = ENDPOINTS[provider];
    const state = generateState(provider);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(" "),
        state,
        response_type: "code",
    });

    return `${endpoints.authorize}?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access + refresh token pair.
 */
export async function exchangeCodeForTokens(
    config: OAuthConfig,
    code: string
): Promise<TokenPair> {
    const endpoints = ENDPOINTS[config.provider];

    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
    });

    const res = await fetch(endpoints.token, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    const data = await res.json();

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? "",
        expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    };
}

/**
 * Fetch the authenticated user's profile from the provider.
 */
export async function fetchUserProfile(
    provider: OAuthProvider,
    accessToken: string
): Promise<User> {
    const endpoints = ENDPOINTS[provider];

    const res = await fetch(endpoints.userInfo, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
        throw new Error(`User profile fetch failed (${res.status})`);
    }

    const data = await res.json();
    return normalizeProfile(provider, data);
}

/**
 * Full OAuth flow: validate state → exchange code → fetch profile.
 */
export async function handleOAuthCallback(
    configs: Map<OAuthProvider, OAuthConfig>,
    params: OAuthCallbackParams
): Promise<AuthResult> {
    const provider = validateState(params.state);
    if (!provider) {
        return { success: false, error: "Invalid or expired OAuth state" };
    }

    const config = configs.get(provider);
    if (!config) {
        return { success: false, error: `No config for provider: ${provider}` };
    }

    try {
        const tokens = await exchangeCodeForTokens(config, params.code);
        const user = await fetchUserProfile(provider, tokens.accessToken);
        return { success: true, user, tokens };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizeProfile(provider: OAuthProvider, raw: any): User {
    const now = new Date();

    switch (provider) {
        case "github":
            return {
                id: `github:${raw.id}`,
                email: raw.email ?? "",
                name: raw.name ?? raw.login,
                avatarUrl: raw.avatar_url,
                provider,
                createdAt: now,
                lastLoginAt: now,
            };

        case "google":
            return {
                id: `google:${raw.id}`,
                email: raw.email,
                name: raw.name,
                avatarUrl: raw.picture,
                provider,
                createdAt: now,
                lastLoginAt: now,
            };

        case "microsoft":
            return {
                id: `microsoft:${raw.id}`,
                email: raw.mail ?? raw.userPrincipalName,
                name: raw.displayName,
                provider,
                createdAt: now,
                lastLoginAt: now,
            };
    }
}
