// Holds the logged-in user + token, persists the token to localStorage so a
// page refresh doesn't log you out, and owns connecting/disconnecting the
// shared socket whenever auth state changes.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { connectSocket, disconnectSocket } from '../api/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('chatter_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    connectSocket(token);
    api
      .get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        // Token expired/invalid -- drop it and force a re-login.
        localStorage.removeItem('chatter_token');
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback((userData, jwt) => {
    localStorage.setItem('chatter_token', jwt);
    setToken(jwt);
    setUser(userData);
    connectSocket(jwt);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('chatter_token');
    disconnectSocket();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
