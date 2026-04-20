import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMeApi, loginApi, logoutApi } from './api';
import type { AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login(identity: string, password: string): Promise<{ success: boolean; error?: string; retryAfterMs?: number }>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getMeApi()
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (identity: string, password: string) => {
    const result = await loginApi(identity, password);
    if (result.ok) {
      setUser(result.user);
      return { success: true };
    }
    return { success: false, error: result.error, retryAfterMs: result.retryAfterMs };
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
