import { describe, expect, it } from 'vitest';
import {
  canonicalResource,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  redirectUriMatches,
} from '../src';

describe('OAuth redirect URI policy', () => {
  it('allows https, loopback http and native private-use schemes', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost/callback')).toBe(true);
    expect(isAllowedRedirectUri('com.example.agent:/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true);
  });

  it('rejects plain http, fragments, credentials and dangerous schemes', () => {
    for (const uri of [
      'http://attacker.example/callback',
      'https://claude.ai/callback#x',
      'https://user:pw@claude.ai/callback',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'not a url',
    ])
      expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it('matches exactly, except the port of loopback redirects', () => {
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb')).toBe(true);
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb2')).toBe(false);
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example:444/cb')).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:49152/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:49152/other')).toBe(false);
  });
});

describe('PKCE and resource indicators', () => {
  it('validates verifier and S256 challenge formats', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(isValidCodeChallenge('short')).toBe(false);
  });

  it('canonicalizes resource indicators', () => {
    expect(canonicalResource('http://localhost:4100/mcp/')).toBe('http://localhost:4100/mcp');
    expect(canonicalResource('http://localhost:4100/mcp#x')).toBeNull();
  });
});
