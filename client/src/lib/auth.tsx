'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setTokens, clearTokens, getStoredUser, setStoredUser } from './api';

export type User = {
  id: string;
  email: string;
  fullName: string;
  role: 'student' | 'faculty' | 'admin';
  isActive: boolean;
  createdAt: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, role: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to restore user from localStorage
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
      // Verify token is still valid
      api<{ user: User }>('/auth/me')
        .then((data) => {
          setUser(data.user);
          setStoredUser(data.user);
        })
        .catch(() => {
          clearTokens();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user: User; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { method: 'POST', body: { email, password } }
    );
    setTokens(data.accessToken, data.refreshToken);
    setStoredUser(data.user);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string, role: string) => {
    const data = await api<{ user: User; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { method: 'POST', body: { email, password, fullName, role } }
    );
    setTokens(data.accessToken, data.refreshToken);
    setStoredUser(data.user);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
