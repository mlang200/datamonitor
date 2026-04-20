import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { requireAuth, requireAdmin } from './middleware.js';
import type { Request, Response, NextFunction } from 'express';

/**
 * Property-Based Tests for Auth Middleware
 * Feature: auth-user-management
 */

/** Helper: create a mock Express request with optional session user */
function mockRequest(sessionUser?: { id: number; username: string; role: 'admin' | 'user' } | null): Partial<Request> {
  const session: Record<string, unknown> = {};
  if (sessionUser !== undefined && sessionUser !== null) {
    session.user = sessionUser;
  }
  return { session } as Partial<Request>;
}

/** Helper: create a mock Express response that captures status and json */
function mockResponse(): { res: Partial<Response>; getStatus: () => number | undefined; getBody: () => unknown } {
  let status: number | undefined;
  let body: unknown;

  const res: Partial<Response> = {
    status(code: number) {
      status = code;
      return this as Response;
    },
    json(data: unknown) {
      body = data;
      return this as Response;
    },
  };

  return { res, getStatus: () => status, getBody: () => body };
}

// Arbitrary for generating invalid/missing session scenarios
const invalidSessionArb = fc.oneof(
  // No session user at all (undefined)
  fc.constant(undefined),
  // Null session user
  fc.constant(null),
  // Missing id
  fc.record({
    id: fc.constant(undefined as unknown as number),
    username: fc.string({ minLength: 1, maxLength: 20 }),
    role: fc.constantFrom('admin' as const, 'user' as const),
  }),
  // Missing username
  fc.record({
    id: fc.integer({ min: 1 }),
    username: fc.constant(undefined as unknown as string),
    role: fc.constantFrom('admin' as const, 'user' as const),
  }),
  // Missing role
  fc.record({
    id: fc.integer({ min: 1 }),
    username: fc.string({ minLength: 1, maxLength: 20 }),
    role: fc.constant(undefined as unknown as 'admin' | 'user'),
  }),
  // id = 0 (falsy)
  fc.record({
    id: fc.constant(0),
    username: fc.string({ minLength: 1, maxLength: 20 }),
    role: fc.constantFrom('admin' as const, 'user' as const),
  }),
  // Empty username (falsy)
  fc.record({
    id: fc.integer({ min: 1 }),
    username: fc.constant(''),
    role: fc.constantFrom('admin' as const, 'user' as const),
  }),
);

// Arbitrary for valid session users
const validUserArb = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  username: fc.string({ minLength: 1, maxLength: 50 }),
  role: fc.constantFrom('admin' as const, 'user' as const),
});

// Arbitrary for valid admin session users
const adminUserArb = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  username: fc.string({ minLength: 1, maxLength: 50 }),
  role: fc.constant('admin' as const),
});

// Arbitrary for valid non-admin session users
const regularUserArb = fc.record({
  id: fc.integer({ min: 1, max: 100000 }),
  username: fc.string({ minLength: 1, maxLength: 50 }),
  role: fc.constant('user' as const),
});

describe('Feature: auth-user-management, Property 7: Auth-Middleware lehnt unauthentifizierte Requests ab', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For every request without a valid session token: HTTP 401 + JSON error message.
   */
  it('returns 401 with JSON error for every unauthenticated request', () => {
    const middleware = requireAuth();

    fc.assert(
      fc.property(invalidSessionArb, (sessionUser) => {
        const req = mockRequest(sessionUser as any);
        const { res, getStatus, getBody } = mockResponse();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(getStatus()).toBe(401);
        expect(getBody()).toEqual({ error: 'Nicht authentifiziert' });
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('passes through and sets req.user for every valid session', () => {
    const middleware = requireAuth();

    fc.assert(
      fc.property(validUserArb, (sessionUser) => {
        const req = mockRequest(sessionUser);
        const { res } = mockResponse();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect((req as Request).user).toEqual(sessionUser);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Feature: auth-user-management, Property 8: Admin-Middleware lehnt Nicht-Admin-Benutzer ab', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.5**
   *
   * User with role `user` → 403, user with role `admin` → passed through.
   */
  it('returns 403 for every authenticated user with role "user"', () => {
    const middleware = requireAdmin();

    fc.assert(
      fc.property(regularUserArb, (sessionUser) => {
        const req = mockRequest(sessionUser);
        const { res, getStatus, getBody } = mockResponse();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(getStatus()).toBe(403);
        expect(getBody()).toEqual({ error: 'Keine Berechtigung' });
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('passes through for every authenticated user with role "admin"', () => {
    const middleware = requireAdmin();

    fc.assert(
      fc.property(adminUserArb, (sessionUser) => {
        const req = mockRequest(sessionUser);
        const { res } = mockResponse();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(next).toHaveBeenCalledOnce();
        expect((req as Request).user).toEqual(sessionUser);
      }),
      { numRuns: 100 },
    );
  });

  it('returns 401 for unauthenticated requests (no session) on admin middleware', () => {
    const middleware = requireAdmin();

    fc.assert(
      fc.property(invalidSessionArb, (sessionUser) => {
        const req = mockRequest(sessionUser as any);
        const { res, getStatus, getBody } = mockResponse();
        const next = vi.fn();

        middleware(req as Request, res as Response, next as NextFunction);

        expect(getStatus()).toBe(401);
        expect(getBody()).toEqual({ error: 'Nicht authentifiziert' });
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
