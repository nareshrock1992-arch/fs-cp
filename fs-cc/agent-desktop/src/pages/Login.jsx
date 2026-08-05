import { useState } from 'react';
import { api }         from '../api/client.js';
import ThemeToggle     from '../components/ThemeToggle.jsx';

export default function Login({ onLogin, theme }) {
  const [agentId, setAgentId] = useState('');
  const [pin,     setPin]     = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(agentId.trim(), pin);
      onLogin(data.token, data.agent);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-panel-bg flex flex-col">

      {/* Theme toggle — top-right corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle isDark={theme.isDark} onToggle={theme.toggle} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center
                            mx-auto mb-4 shadow-lg shadow-brand/30">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21
                     l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0
                     011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1
                     C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-ink">Agent Desktop</h1>
            <p className="text-ink-faint text-sm mt-1">FreeSWITCH Contact Center</p>
          </div>

          {/* Form card */}
          <form onSubmit={handleSubmit} className="card p-6 space-y-4">

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg
                              px-4 py-2.5 text-red-500 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="stat-label block mb-1.5">Agent ID</label>
              <input
                type="text"
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
                placeholder="e.g. agent_1001"
                required
                autoFocus
                className="field-input"
              />
            </div>

            <div>
              <label className="stat-label block mb-1.5">PIN</label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••"
                required
                inputMode="numeric"
                className="field-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-2.5 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Signing in…
                </>
              ) : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-[11px] text-ink-faint mt-6">
            CC Version 1.0.0 · © Naresh — All Rights Reserved
          </p>
        </div>
      </div>
    </div>
  );
}
