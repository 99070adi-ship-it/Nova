import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  API_BASE_URL,
  CurrentUser,
  demoLogin as apiDemoLogin,
  getMe,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  setAccessToken,
} from "../api/client";

interface AuthState {
  isAuthenticated: boolean;
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { org_name: string; full_name: string; email: string; password: string }) => Promise<void>;
  enterDemo: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // On load, try a silent refresh against the httpOnly refresh cookie (if the browser still
    // has one from a prior session) so a page reload doesn't force a fresh login.
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" });
        if (res.ok) {
          const body = await res.json();
          setAccessToken(body.access_token);
          setUser(await getMe());
        }
      } catch {
        // no valid session — user will see the login page
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { access_token } = await apiLogin(email, password);
    setAccessToken(access_token);
    setUser(await getMe());
  };

  const signup = async (input: { org_name: string; full_name: string; email: string; password: string }) => {
    const { access_token } = await apiSignup(input);
    setAccessToken(access_token);
    setUser(await getMe());
  };

  const enterDemo = async () => {
    const { access_token } = await apiDemoLogin();
    setAccessToken(access_token);
    setUser(await getMe());
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: user !== null, user, loading, login, signup, enterDemo, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** The signed-in user's id, or null when there is no provider/user. Unlike `useAuth` it never throws, so
 * UI that is only personalised by the user (the Guide's voice preference) can render anywhere. */
export function useCurrentUserKey(): string | null {
  return useContext(AuthContext)?.user?.id ?? null;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
