import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth.jsx';
import { useApi, formatDateTime } from '../hooks.js';
import { Alert, Field, Modal, StatusBadge } from '../components/ui.jsx';

const STATUS_TEXT = {
  checkin_pending: 'You have been inactive. Sign-in activity or a check-in cancels this.',
  awaiting_admin: 'Waiting for an administrator to confirm. Nothing has been sent.',
  scheduled: 'Messages are scheduled. You can still cancel.',
  dispatching: 'Messages are being sent now.',
};

export default function SendPage() {
  const { user } = useAuth();
  const runs = useApi('/activations');
  const templates = useApi('/templates');
  const contacts = useApi('/contacts');
  const [step, setStep] = useState(0);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const byId = Object.fromEntries((contacts.data?.contacts || []).map((c) => [c.id, c]));
  const plan = (templates.data?.templates || []).flatMap((t) => t.contactIds.map((id) => ({ t, c: byId[id] }))).filter((p) => p.c);
  const current = runs.data?.current;
  const required = runs.data?.confirmationPhrase || 'SEND MY MESSAGES';

  const close = () => { setStep(0); setPhrase(''); setPassword(''); setError(''); setCancelOpen(false); };

  const trigger = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/activations', { method: 'POST', body: { password, confirmationPhrase: phrase } });
      close();
      runs.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/activations/${current.id}/cancel`, { method: 'POST', body: { password } });
      close();
      runs.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    await api('/me/check-in', { method: 'POST' });
    runs.reload();
  };

  return (
    <>
      <h1>Send messages</h1>
      {runs.data && runs.data.smsMode === 'mock' && (
        <Alert kind="info">SMS is in test mode: messages are logged by the server, not delivered.</Alert>
      )}
      {runs.data && !runs.data.notificationsEnabled && (
        <Alert kind="warning">Sending is switched off on the server. Scheduled runs will wait until it is switched back on.</Alert>
      )}

      {current ? (
        <section className="card card-warning">
          <h2>Current run <StatusBadge status={current.status} /></h2>
          <p>{STATUS_TEXT[current.status]}</p>
          {current.checkInDeadline && current.status === 'checkin_pending' && <p>Check-in deadline: <strong>{formatDateTime(current.checkInDeadline)}</strong></p>}
          {current.dispatchAt && <p>Sends at: <strong>{formatDateTime(current.dispatchAt)}</strong></p>}
          <div className="actions">
            {current.source === 'inactivity' && <button className="btn btn-primary" onClick={checkIn}>I'm here, cancel it</button>}
            {current.status !== 'dispatching' && <button className="btn btn-danger" onClick={() => setCancelOpen(true)}>Cancel this run</button>}
          </div>
        </section>
      ) : (
        <section className="card">
          <h2>Send now</h2>
          <p>
            This sends each prepared message to its recipients. After you confirm, there is a{' '}
            <strong>{user.dispatchDelayHours}-hour</strong> waiting period before anything goes out, and you can cancel during it.
          </p>
          <p className="muted">{plan.length} message(s) to {new Set(plan.map((p) => p.c.id)).size} contact(s) are ready.</p>
          <button className="btn btn-danger" disabled={plan.length === 0} onClick={() => setStep(1)}>Start sending…</button>
        </section>
      )}

      <section className="card">
        <h2>Past runs</h2>
        <table>
          <thead><tr><th>Started</th><th>How</th><th>Status</th><th>Finished</th></tr></thead>
          <tbody>
            {runs.data?.activations.map((a) => (
              <tr key={a.id}>
                <td>{formatDateTime(a.createdAt)}</td>
                <td>{a.source === 'manual' ? 'Sent by you' : 'Inactivity'}</td>
                <td><StatusBadge status={a.status} />{a.cancelReason && <span className="muted"> ({a.cancelReason.replace(/_/g, ' ')})</span>}</td>
                <td>{formatDateTime(a.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Modal open={step === 1} title="Step 1 of 2: check who gets what" onClose={close}>
        <ul className="plain review">
          {plan.map(({ t, c }) => (
            <li key={`${t.id}-${c.id}`}><strong>{c.name}</strong> <span className="muted">{c.phone}</span><br />“{t.body.replace(/\{\{\s*name\s*\}\}/gi, c.name)}”</li>
          ))}
        </ul>
        <div className="actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn btn-danger" onClick={() => setStep(2)}>This is correct</button>
        </div>
      </Modal>

      <Modal open={step === 2} title="Step 2 of 2: confirm" onClose={close}>
        <form onSubmit={trigger}>
          <Alert>{error}</Alert>
          <Field label={`Type ${required} to confirm`} id="phrase">
            <input id="phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" required />
          </Field>
          <Field label="Your password" id="tpw">
            <input id="tpw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="actions">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button className="btn btn-danger" disabled={busy || phrase !== required || !password}>Schedule messages</button>
          </div>
        </form>
      </Modal>

      <Modal open={cancelOpen} title="Cancel this run" onClose={close}>
        <form onSubmit={cancelRun}>
          <Alert>{error}</Alert>
          <Field label="Your password" id="cpw">
            <input id="cpw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="actions">
            <button type="button" className="btn" onClick={close}>Keep it</button>
            <button className="btn btn-primary" disabled={busy}>Cancel run</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
