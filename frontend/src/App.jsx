import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Checklist from './pages/Checklist.jsx';
import Contacts from './pages/Contacts.jsx';
import Messages from './pages/Messages.jsx';
import SendPage from './pages/Send.jsx';
import Activity from './pages/Activity.jsx';
import Trusted from './pages/Trusted.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/checklist', 'Checklist'],
  ['/contacts', 'Contacts'],
  ['/messages', 'Messages'],
  ['/send', 'Send'],
  ['/trusted', 'Emergency contacts'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings'],
];

export default function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p className="center">Loading…</p>;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="layout">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <span className="brand">Legacy Planner</span>
        <nav aria-label="Main">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
          {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <button className="btn-link" onClick={logout}>Sign out</button>
      </header>
      <main id="main" className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/checklist" element={<Checklist />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/send" element={<SendPage />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/trusted" element={<Trusted />} />
          <Route path="/settings" element={<Settings />} />
          {user.role === 'admin' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
