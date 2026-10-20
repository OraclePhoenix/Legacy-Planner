import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api('/me').then((d) => setUser(d.user)).catch(logout).finally(() => setLoading(false));
  }, [logout]);

  const signIn = async (path, body) => {
    const data = await api(`/auth/${path}`, { method: 'POST', body });
    tokenStore.set(data.token);
    setUser(data.user);
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout, signIn }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
