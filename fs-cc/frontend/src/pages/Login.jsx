import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import { Auth } from '../api/client.js';
import { setToken } from '../hooks/useAuth.js';

export default function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setLoading(true);
    try {
      const { token } = await Auth.login(username.trim().toLowerCase(), password);
      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Login failed.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-panel-bg flex items-center justify-center p-4"
         style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(37,99,235,0.06), transparent 50%), radial-gradient(circle at 70% 80%, rgba(76,142,245,0.04), transparent 50%)' }}>

      <div className="w-full max-w-sm animate-slide-in-up">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-brand shadow-lamp-blue mb-5">
            <Radio size={24} className="text-white" />
          </div>
          <h1 className="font-display font-bold text-2xl tracking-wide text-ink">Switchboard</h1>
          <p className="text-sm text-ink-faint mt-1">FreeSWITCH Contact Center</p>
        </div>

        {/* Card */}
        <div className="bg-panel-surface border border-panel-border rounded-2xl shadow-card-dark p-7">
          <p className="text-sm font-semibold text-ink-dim mb-5">Sign in to your account</p>

          {/* Error */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-lamp-alert/10 border border-lamp-alert/25 px-3.5 py-3">
              <AlertCircle size={15} className="text-lamp-alert shrink-0 mt-0.5" />
              <p className="text-sm text-lamp-alert leading-snug">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[11px] font-semibold text-ink-faint mb-1.5 uppercase tracking-widest">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                className="field-input"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-semibold text-ink-faint mb-1.5 uppercase tracking-widest">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field-input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-dim transition-colors"
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 mt-1 shadow-lamp-blue"
            >
              {loading
                ? <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <LogIn size={15} />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-ink-faint mt-5">
          FreeSWITCH ACD · Avaya Aura Gateway
        </p>
      </div>
    </div>
  );
}
