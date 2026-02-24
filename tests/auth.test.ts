/**
 * Tests for OAuth client (src/auth/oauth.ts)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    getAuthorizationUrl,
    exchangeCodeForTokens,
    fetchUserProfile,
    handleOAuthCallback,
} from "../src/auth/oauth";
import { OAuthConfig, OAuthProvider } from "../src/types/auth";

// ── Fixtures ────────────────────────────────────────────────────────────

const githubConfig: OAuthConfig = {
    provider: "github",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/auth/callback",
    scopes: ["read:user", "user:email"],
};

const googleConfig: OAuthConfig = {
    provider: "google",
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    redirectUri: "http://localhost:3000/auth/callback",
    scopes: ["openid", "email", "profile"],
};

// ── getAuthorizationUrl ─────────────────────────────────────────────────

describe("getAuthorizationUrl", () => {
    it("should return a GitHub authorization URL with correct params", () => {
        const url = getAuthorizationUrl(githubConfig);
        expect(url).toContain("https://github.com/login/oauth/authorize");
        expect(url).toContain("client_id=test-client-id");
        expect(url).toContain("redirect_uri=");
        expect(url).toContain("scope=read%3Auser+user%3Aemail");
        expect(url).toContain("response_type=code");
        expect(url).toContain("state=");
    });

    it("should return a Google authorization URL", () => {
        const url = getAuthorizationUrl(googleConfig);
        expect(url).toContain("https://accounts.google.com");
        expect(url).toContain("client_id=google-client-id");
    });

    it("should generate unique state for each call", () => {
        const url1 = getAuthorizationUrl(githubConfig);
        const url2 = getAuthorizationUrl(githubConfig);
        const state1 = new URL(url1).searchParams.get("state");
        const state2 = new URL(url2).searchParams.get("state");
        expect(state1).not.toBe(state2);
    });
});

// ── exchangeCodeForTokens ───────────────────────────────────────────────

describe("exchangeCodeForTokens", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("should exchange code for tokens on success", async () => {
        const mockResponse = {
            access_token: "gho_abc123",
            refresh_token: "ghr_xyz789",
            expires_in: 3600,
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse),
        });

        const tokens = await exchangeCodeForTokens(githubConfig, "auth-code-123");

        expect(tokens.accessToken).toBe("gho_abc123");
        expect(tokens.refreshToken).toBe("ghr_xyz789");
        expect(tokens.expiresAt).toBeInstanceOf(Date);
        expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("should throw on failed token exchange", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("bad_verification_code"),
        });

        await expect(
            exchangeCodeForTokens(githubConfig, "bad-code")
        ).rejects.toThrow("Token exchange failed (401)");
    });

    it("should handle missing refresh_token", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
        });

        const tokens = await exchangeCodeForTokens(githubConfig, "code");
        expect(tokens.refreshToken).toBe("");
    });
});

// ── fetchUserProfile ────────────────────────────────────────────────────

describe("fetchUserProfile", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("should fetch and normalize a GitHub profile", async () => {
        const githubUser = {
            id: 12345,
            login: "octocat",
            name: "Octo Cat",
            email: "octo@github.com",
            avatar_url: "https://avatars.githubusercontent.com/u/12345",
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(githubUser),
        });

        const user = await fetchUserProfile("github", "gho_abc123");

        expect(user.id).toBe("github:12345");
        expect(user.email).toBe("octo@github.com");
        expect(user.name).toBe("Octo Cat");
        expect(user.avatarUrl).toContain("avatars.githubusercontent.com");
        expect(user.provider).toBe("github");
    });

    it("should fetch and normalize a Google profile", async () => {
        const googleUser = {
            id: "g-67890",
            email: "user@gmail.com",
            name: "Google User",
            picture: "https://lh3.googleusercontent.com/photo",
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(googleUser),
        });

        const user = await fetchUserProfile("google", "ya29.abc");

        expect(user.id).toBe("google:g-67890");
        expect(user.email).toBe("user@gmail.com");
        expect(user.provider).toBe("google");
    });

    it("should fetch and normalize a Microsoft profile", async () => {
        const msUser = {
            id: "ms-11111",
            displayName: "MS User",
            mail: "user@outlook.com",
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(msUser),
        });

        const user = await fetchUserProfile("microsoft", "eyJ...");

        expect(user.id).toBe("microsoft:ms-11111");
        expect(user.email).toBe("user@outlook.com");
        expect(user.name).toBe("MS User");
    });

    it("should throw on failed profile fetch", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
        });

        await expect(
            fetchUserProfile("github", "bad-token")
        ).rejects.toThrow("User profile fetch failed (403)");
    });
});

// ── handleOAuthCallback ─────────────────────────────────────────────────

describe("handleOAuthCallback", () => {
    it("should return error for invalid state", async () => {
        const configs = new Map<OAuthProvider, OAuthConfig>();
        configs.set("github", githubConfig);

        const result = await handleOAuthCallback(configs, {
            code: "abc",
            state: "invalid-state-xxx",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Invalid or expired");
    });
});
