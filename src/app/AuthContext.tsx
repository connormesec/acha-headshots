import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi, type Me } from "./api";

/** Who is using the page. Hiding admin-only controls is a convenience: the server checks the
 * admin cookie on every call that costs money. */
interface AuthState {
  /** undefined while loading */
  me: Me | undefined;
  refresh: () => Promise<void>;
  setMe: (me: Me) => void;
}

const OFFLINE: Me = { admin: false, loginAvailable: false, visionAvailable: false, spend: null, offline: true };

const AuthContext = createContext<AuthState>({ me: undefined, refresh: async () => {}, setMe: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>();
  const refresh = useCallback(async () => {
    try {
      setMe(await authApi.me());
    } catch {
      setMe(OFFLINE);
    }
  }, []);
  useEffect(() => {
    void refresh();
    // The admin session can expire while the tab is open.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return <AuthContext.Provider value={{ me, refresh, setMe }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
