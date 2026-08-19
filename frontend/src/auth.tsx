// AuthContext: single source of truth for the logged-in user + JWT.
// - On boot, restores the token from SecureStore and hydrates the user via /auth/me.
// - Exposes login/register/logout that all screens can call.
// - After login, expo-router's index.tsx decides which role stack to send them to.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type Role = "client" | "reporter" | "admin";
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  verified?: boolean;
};

type AuthState = {
  ready: boolean;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (name: string, email: string, password: string, role: Role) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        try {
          const me = await apiGet<AuthUser>("/auth/me");
          setUser(me);
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiPost<{ access_token: string; user: AuthUser }>("/auth/login", { email, password });
    await storage.secureSet(TOKEN_KEY, res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, role: Role) => {
    const res = await apiPost<{ access_token: string; user: AuthUser }>("/auth/register", { name, email, password, role });
    await storage.secureSet(TOKEN_KEY, res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await apiGet<AuthUser>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
      await storage.secureRemove(TOKEN_KEY);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, user, login, register, logout, refresh }),
    [ready, user, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
