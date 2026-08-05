import { useEffect } from 'react';
import { useAgentAuth }     from './hooks/useAgentAuth.js';
import { useTheme }         from './hooks/useTheme.js';
import { authenticateAgent } from './api/socket.js';
import Login     from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  const auth  = useAgentAuth();
  const theme = useTheme();

  useEffect(() => {
    if (auth.token) authenticateAgent(auth.token);
  }, [auth.token]);

  if (!auth.isAuthenticated) {
    return <Login onLogin={auth.login} theme={theme} />;
  }

  return <Dashboard auth={auth} theme={theme} />;
}
