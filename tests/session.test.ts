/**
 * Tests for session management (src/auth/session.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager, InMemorySessionStore } from "../src/auth/session";
import { User } from "../src/types/auth";

// ── Fixtures ────────────────────────────────────────────────────────────

function createTestUser(overrides: Partial<User> = {}): User {
    return {
        id: "github:12345",
        email: "test@example.com",
        name: "Test User",
        provider: "github",
        createdAt: new Date(),
        lastLoginAt: new Date(),
        ...overrides,
    };
}

// ── InMemorySessionStore ────────────────────────────────────────────────

describe("InMemorySessionStore", () => {
    let store: InMemorySessionStore;

    beforeEach(() => {
        store = new InMemorySessionStore();
    });

    it("should store and retrieve a session", async () => {
        const session = {
            id: "sess-123",
            userId: "user-1",
            user: createTestUser(),
            csrfToken: "csrf-abc",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
            isActive: true,
        };

        await store.set(session);
        const retrieved = await store.get("sess-123");

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe("sess-123");
        expect(retrieved!.userId).toBe("user-1");
    });

    it("should return null for unknown session", async () => {
        const result = await store.get("nonexistent");
        expect(result).toBeNull();
    });

    it("should return null for expired session and auto-remove it", async () => {
        const session = {
            id: "expired-sess",
            userId: "user-1",
            user: createTestUser(),
            csrfToken: "csrf",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() - 1000), // already expired
            isActive: true,
        };

        await store.set(session);
        expect(store.size).toBe(1);

        const result = await store.get("expired-sess");
        expect(result).toBeNull();
        expect(store.size).toBe(0);
    });

    it("should return null for inactive session", async () => {
        const session = {
            id: "inactive-sess",
            userId: "user-1",
            user: createTestUser(),
            csrfToken: "csrf",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
            isActive: false,
        };

        await store.set(session);
        const result = await store.get("inactive-sess");
        expect(result).toBeNull();
    });

    it("should delete a session", async () => {
        const session = {
            id: "del-sess",
            userId: "user-1",
            user: createTestUser(),
            csrfToken: "csrf",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
            isActive: true,
        };

        await store.set(session);
        expect(store.size).toBe(1);

        await store.delete("del-sess");
        expect(store.size).toBe(0);
    });

    it("should cleanup expired sessions", async () => {
        const active = {
            id: "active",
            userId: "user-1",
            user: createTestUser(),
            csrfToken: "csrf",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
            isActive: true,
        };
        const expired = {
            id: "expired",
            userId: "user-2",
            user: createTestUser({ id: "github:99" }),
            csrfToken: "csrf2",
            createdAt: new Date(),
            expiresAt: new Date(Date.now() - 1000),
            isActive: true,
        };

        await store.set(active);
        await store.set(expired);
        expect(store.size).toBe(2);

        const removed = await store.cleanup();
        expect(removed).toBe(1);
        expect(store.size).toBe(1);
    });
});

// ── SessionManager ──────────────────────────────────────────────────────

describe("SessionManager", () => {
    let manager: SessionManager;
    let store: InMemorySessionStore;

    beforeEach(() => {
        store = new InMemorySessionStore();
        manager = new SessionManager(store, {
            maxAge: 3600,
            cleanupInterval: 60,
        });
    });

    afterEach(() => {
        manager.stopCleanup();
    });

    it("should create a session with valid fields", async () => {
        const user = createTestUser();
        const session = await manager.createSession(user);

        expect(session.id).toBeTruthy();
        expect(session.id.length).toBe(64); // 32 bytes hex
        expect(session.userId).toBe(user.id);
        expect(session.user).toEqual(user);
        expect(session.csrfToken).toBeTruthy();
        expect(session.csrfToken.length).toBe(48); // 24 bytes hex
        expect(session.isActive).toBe(true);
        expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("should retrieve a created session", async () => {
        const user = createTestUser();
        const session = await manager.createSession(user);
        const retrieved = await manager.getSession(session.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(session.id);
    });

    it("should return null for unknown session", async () => {
        const result = await manager.getSession("does-not-exist");
        expect(result).toBeNull();
    });

    it("should validate correct CSRF token", async () => {
        const session = await manager.createSession(createTestUser());
        const valid = await manager.validateCsrf(session.id, session.csrfToken);
        expect(valid).toBe(true);
    });

    it("should reject incorrect CSRF token", async () => {
        const session = await manager.createSession(createTestUser());
        const valid = await manager.validateCsrf(session.id, "wrong-token-value-x");
        expect(valid).toBe(false);
    });

    it("should reject CSRF for unknown session", async () => {
        const valid = await manager.validateCsrf("no-session", "any-token");
        expect(valid).toBe(false);
    });

    it("should destroy a session", async () => {
        const session = await manager.createSession(createTestUser());
        await manager.destroySession(session.id);

        const result = await manager.getSession(session.id);
        expect(result).toBeNull();
    });

    it("should touch (extend) a session", async () => {
        const session = await manager.createSession(createTestUser());
        const originalExpiry = session.expiresAt.getTime();

        // Small delay to ensure time changes
        await new Promise((r) => setTimeout(r, 10));

        const touched = await manager.touchSession(session.id);
        expect(touched).not.toBeNull();
        expect(touched!.expiresAt.getTime()).toBeGreaterThanOrEqual(originalExpiry);
    });

    it("should return null when touching unknown session", async () => {
        const result = await manager.touchSession("ghost-session");
        expect(result).toBeNull();
    });

    it("should expose cookie config", () => {
        const cookie = manager.cookieConfig;
        expect(cookie.name).toBe("sid");
        expect(cookie.secure).toBe(true);
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe("lax");
        expect(cookie.maxAge).toBe(3600);
    });
});
