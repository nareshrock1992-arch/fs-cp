import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('cc-theme');
    if (saved) return saved === 'dark';
  } catch {}
  return true; // default: dark
}

export default function Layout() {
  const [isDark, setIsDark] = useState(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try { localStorage.setItem('cc-theme', isDark ? 'dark' : 'light'); } catch {}
  }, [isDark]);

  const toggleTheme = () => setIsDark((d) => !d);

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-gray-50 dark:bg-panel-bg text-gray-900 dark:text-ink antialiased">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar isDark={isDark} toggleTheme={toggleTheme} />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
