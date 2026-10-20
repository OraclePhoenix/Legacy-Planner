import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/ui.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await signIn(mode, mode === 'login' ? { email: form.email, password: form.password } : form);
      if (data.cancelledInactivityRuns) setNotice('Welcome back. A pending inactivity notification was cancelled.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Legacy Planner</h1>
        <p className="muted">{mode === 'login' ? 'Sign in to your plan.' : 'Create your account.'}</p>
        <Alert>{error}</Alert>
        <Alert kind="info">{notice}</Alert>
        {mode === 'register' && (
          <Field label="Name" id="name"><input id="name" value={form.name} onChange={set('name')} required autoComplete="name" /></Field>
        )}
        <Field label="Email" id="email"><input id="email" type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></Field>
        <Field label="Password" id="password" hint={mode === 'register' ? 'At least 10 characters, with a letter and a number.' : null}>
          <input id="password" type="password" value={form.password} onChange={set('password')} required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'register' ? 'password-hint' : undefined} />
        </Field>
        <button className="btn btn-primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="btn-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}
