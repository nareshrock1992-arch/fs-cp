import { useState, useEffect, useCallback } from 'react';

const TOKEN_KEY = 'agent_token';
const INFO_KEY  = 'agent_info';

function readStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const agent = JSON.parse(localStorage.getItem(INFO_KEY) || 'null');
    if (!token || !agent) return { token: null, agent: null };

    // Check expiry (JWT exp is in seconds)
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(INFO_KEY);
      return { token: null, agent: null };
    }

    return { token, agent };
  } catch {
    return { token: null, agent: null };
  }
}

export function useAgentAuth() {
  const [{ token, agent }, setAuth] = useState(readStored);

  const login = useCallback((newToken, newAgent) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(INFO_KEY, JSON.stringify(newAgent));
    setAuth({ token: newToken, agent: newAgent });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
    setAuth({ token: null, agent: null });
  }, []);

  // Update agent info (e.g. after status change comes back from server)
  const updateAgent = useCallback((patch) => {
    setAuth(prev => {
      const updated = { ...prev.agent, ...patch };
      localStorage.setItem(INFO_KEY, JSON.stringify(updated));
      return { ...prev, agent: updated };
    });
  }, []);

  // Re-check expiry once per minute
  useEffect(() => {
    const id = setInterval(() => {
      const stored = readStored();
      if (!stored.token) setAuth({ token: null, agent: null });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return {
    token,
    agent,
    isAuthenticated: !!token && !!agent,
    login,
    logout,
    updateAgent,
  };
}
