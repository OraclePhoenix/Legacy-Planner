import { useState } from 'react';
import { api, tokenStore } from '../api/client.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/ui.jsx';

export default function Settings() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user.name,
    phone: user.phone || '',
    inactivityEnabled: user.inactivityEnabled,
    inactivityDays: user.inactivityDays,
    checkinGraceHours: user.checkinGraceHours,
    dispatchDelayHours: user.dispatchDelayHours,
    requireAdminConfirmation: user.requireAdminConfirmation,
    requireTrusteeConfirmation: user.requireTrusteeConfirmation,
    remindersEnabled: user.remindersEnabled,
    reminderIntervalDays: user.reminderIntervalDays,
    reminderLookaheadDays: user.reminderLookaheadDays,
  });
  const [pw, setPw] = useState({ currentPassword: '', password: '' });
  const [msg, setMsg] = useState({});
  const set = (k, num) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? Number(e.target.value) : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    try {
      const { user: updated } = await api('/me', { method: 'PATCH', body: { ...form, phone: form.phone || null } });
      setUser(updated);
      setMsg({ ok: 'Settings saved.' });
    } catch (err) {
      setMsg({ error: err.message });
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    try {
      const { token } = await api('/me/password', { method: 'POST', body: pw });
      tokenStore.set(token);
      setPw({ currentPassword: '', password: '' });
      setMsg({ ok: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setMsg({ error: err.message });
    }
  };

  return (
    <>
      <h1>Settings</h1>
      <Alert>{msg.error}</Alert>
      <Alert kind="info">{msg.ok}</Alert>
      <form className="card" onSubmit={save}>
        <h2>Profile</h2>
        <Field label="Name" id="sname"><input id="sname" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Your mobile number" id="sphone" hint="Check-in reminders and send warnings go here. International format, e.g. +14155550123.">
          <input id="sphone" type="tel" value={form.phone} onChange={set('phone')} aria-describedby="sphone-hint" />
        </Field>

        <h2>Task reminders</h2>
        <label className="check">
          <input type="checkbox" checked={form.remindersEnabled} onChange={set('remindersEnabled')} /> Text me about overdue and upcoming checklist tasks
        </label>
        <div className="row">
          <Field label="Every how many days" id="rint">
            <input id="rint" type="number" min={1} max={30} value={form.reminderIntervalDays} onChange={set('reminderIntervalDays', true)} />
          </Field>
          <Field label="Include tasks due within (days)" id="rlook">
            <input id="rlook" type="number" min={0} max={60} value={form.reminderLookaheadDays} onChange={set('reminderLookaheadDays', true)} />
          </Field>
        </div>
        <p className="muted">Only pending tasks with a due date are included. Nothing is sent when nothing is due.</p>

        <h2>Automatic sending if I'm inactive</h2>
        <label className="check">
          <input type="checkbox" checked={form.inactivityEnabled} onChange={set('inactivityEnabled')} /> Turn on the inactivity check
        </label>
        <div className="row">
          <Field label="Days without signing in" id="sdays">
            <input id="sdays" type="number" min={7} max={365} value={form.inactivityDays} onChange={set('inactivityDays', true)} />
          </Field>
          <Field label="Hours to respond to the check-in" id="sgrace">
            <input id="sgrace" type="number" min={24} max={720} value={form.checkinGraceHours} onChange={set('checkinGraceHours', true)} />
          </Field>
          <Field label="Hours of final waiting before sending" id="sdelay">
            <input id="sdelay" type="number" min={1} max={168} value={form.dispatchDelayHours} onChange={set('dispatchDelayHours', true)} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.requireAdminConfirmation} onChange={set('requireAdminConfirmation')} /> Require an administrator to confirm before inactivity messages are sent
        </label>
        <label className="check">
          <input type="checkbox" checked={form.requireTrusteeConfirmation} onChange={set('requireTrusteeConfirmation')} /> Require one of my emergency contacts to confirm (someone other than the person who reported)
        </label>
        <p className="muted">
          How it works: after {form.inactivityDays} days without signing in we text you. If you don't sign in within {form.checkinGraceHours} hours,
          {form.requireAdminConfirmation ? ' an administrator is asked to confirm, then' : form.requireTrusteeConfirmation ? ' an emergency contact is asked to confirm, then' : ''} messages are scheduled to send {form.dispatchDelayHours} hours later.
          Signing in at any point before then cancels it. The same steps apply if an emergency contact reports that something has happened.
        </p>
        <button className="btn btn-primary">Save settings</button>
      </form>

      <form className="card" onSubmit={changePassword}>
        <h2>Change password</h2>
        <Field label="Current password" id="pcur">
          <input id="pcur" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" required />
        </Field>
        <Field label="New password" id="pnew" hint="At least 10 characters, with a letter and a number.">
          <input id="pnew" type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" required aria-describedby="pnew-hint" />
        </Field>
        <button className="btn">Change password</button>
      </form>
    </>
  );
}
