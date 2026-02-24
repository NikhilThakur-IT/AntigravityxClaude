/**
 * Core authentication type definitions.
 * These interfaces define the contract for the auth system.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: OAuthProvider;
  createdAt: Date;
  lastLoginAt: Date;
}

export type OAuthProvider = "github" | "google" | "microsoft";

export interface OAuthConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  tokens?: TokenPair;
  error?: string;
}

export interface OAuthCallbackParams {
  code: string;
  state: string;
}
