import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi, formatDateTime } from '../hooks.js';
import { Alert, Field, Modal, StatusBadge } from '../components/ui.jsx';

const ACTIONS = {
  report: { title: 'Report that something has happened', button: 'Report', path: (p) => `/trustees/people/${p.id}/report` },
  confirm: { title: 'Confirm sending their messages', button: 'Confirm', path: (p) => `/trustees/people/${p.id}/activations/${p.currentRun.id}/confirm` },
  withdraw: { title: 'Withdraw your report', button: 'Withdraw', path: (p) => `/trustees/people/${p.id}/activations/${p.currentRun.id}/withdraw` },
};

function MyContacts() {
  const { data, reload } = useApi('/trustees');
  const [email, setEmail] = useState('');
  const [canConfirm, setCanConfirm] = useState(false);
  const [error, setError] = useState('');

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/trustees', { method: 'POST', body: { email, canReport: true, canConfirm } });
      setEmail('');
      setCanConfirm(false);
      setError('');
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const update = async (t, changes) => {
    await api(`/trustees/${t.id}`, { method: 'PATCH', body: changes });
    reload();
  };

  const remove = async (t) => {
    if (!window.confirm(`Remove ${t.name || t.email} as an emergency contact?`)) return;
    await api(`/trustees/${t.id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <section className="card">
      <h2>Your emergency contacts</h2>
      <p className="muted">
        People you trust to tell us if something has happened to you. They need their own Legacy Planner account with this email.
        They only see your name and whether a notification run is in progress, never your checklist, contacts or messages.
      </p>
      <table>
        <thead><tr><th>Person</th><th>Status</th><th>Can report</th><th>Can confirm sending</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {data?.trustees.map((t) => (
            <tr key={t.id}>
              <td>{t.name || t.email}{t.name && <><br /><span className="muted">{t.email}</span></>}</td>
              <td><StatusBadge status={t.status} /></td>
              <td><input type="checkbox" aria-label={`${t.email} can report`} checked={t.canReport} onChange={(e) => update(t, { canReport: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`${t.email} can confirm sending`} checked={t.canConfirm} onChange={(e) => update(t, { canConfirm: e.target.checked })} /></td>
              <td className="right"><button className="btn-link danger" onClick={() => remove(t)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.trustees.length === 0 && <p className="muted">No emergency contacts yet.</p>}
      <form onSubmit={add} className="add-trustee">
        <Alert>{error}</Alert>
        <Field label="Add by email" id="temail"><input id="temail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <label className="check"><input type="checkbox" checked={canConfirm} onChange={(e) => setCanConfirm(e.target.checked)} /> Can also confirm sending</label>
        <button className="btn btn-primary">Add</button>
      </form>
    </section>
  );
}

function PeopleWhoTrustMe() {
  const invites = useApi('/trustees/invitations');
  const people = useApi('/trustees/people');
  const [action, setAction] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const answer = async (inv, verb) => {
    await api(`/trustees/invitations/${inv.id}/${verb}`, { method: 'POST' });
    invites.reload();
    people.reload();
  };

  const close = () => { setAction(null); setPassword(''); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api(ACTIONS[action.kind].path(action.person), { method: 'POST', body: { password } });
      close();
      people.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card">
      <h2>People who trust you</h2>
      {invites.data?.invitations.map((inv) => (
        <div key={inv.id} className="alert alert-info">
          <strong>{inv.ownerName}</strong> asked you to be an emergency contact
          {inv.canConfirm ? ', including confirming that their messages should be sent' : ''}.
          <div className="actions">
            <button className="btn btn-primary" onClick={() => answer(inv, 'accept')}>Accept</button>
            <button className="btn" onClick={() => answer(inv, 'decline')}>Decline</button>
          </div>
        </div>
      ))}
      {people.data?.people.map((p) => {
        const run = p.currentRun;
        return (
          <div key={p.id} className="person">
            <h3>{p.name} <span className="muted">{p.email}</span></h3>
            {run ? (
              <p>
                <StatusBadge status={run.status} />{' '}
                {run.status === 'checkin_pending' && <>They have until {formatDateTime(run.checkInDeadline)} to sign in and stop it.</>}
                {run.status === 'awaiting_trustee' && <>Waiting for an emergency contact to confirm.</>}
                {run.status === 'scheduled' && <>Messages send at {formatDateTime(run.dispatchAt)} unless they sign in.</>}
              </p>
            ) : <p className="muted">Nothing in progress.</p>}
            <div className="actions">
              {!run && p.canReport && <button className="btn btn-danger" onClick={() => setAction({ kind: 'report', person: p })}>Report that something has happened</button>}
              {run?.status === 'awaiting_trustee' && p.canConfirm && !run.reportedByMe && (
                <button className="btn btn-danger" onClick={() => setAction({ kind: 'confirm', person: p })}>Confirm sending</button>
              )}
              {run?.reportedByMe && ['checkin_pending', 'awaiting_trustee', 'awaiting_admin', 'scheduled'].includes(run.status) && (
                <button className="btn" onClick={() => setAction({ kind: 'withdraw', person: p })}>Withdraw my report</button>
              )}
            </div>
          </div>
        );
      })}
      {people.data?.people.length === 0 && invites.data?.invitations.length === 0 && <p className="muted">Nobody has added you yet.</p>}

      <Modal open={Boolean(action)} title={action ? ACTIONS[action.kind].title : ''} onClose={close}>
        <form onSubmit={submit}>
          <Alert>{error}</Alert>
          {action?.kind === 'report' && (
            <p>{action.person.name} will get a text asking them to sign in. If they don't, their prepared messages are scheduled, with a further waiting period before anything is sent.</p>
          )}
          {action?.kind === 'confirm' && <p>Their messages will be scheduled to send after their waiting period. They can still stop it by signing in.</p>}
          <Field label="Your password" id="trpw">
            <input id="trpw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="actions">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button className={action?.kind === 'withdraw' ? 'btn btn-primary' : 'btn btn-danger'}>{action && ACTIONS[action.kind].button}</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export default function Trusted() {
  return (
    <>
      <h1>Emergency contacts</h1>
      <MyContacts />
      <PeopleWhoTrustMe />
    </>
  );
}
