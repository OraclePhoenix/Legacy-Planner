import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi, formatDateTime } from '../hooks.js';
import { Alert, StatusBadge } from '../components/ui.jsx';

export default function Admin() {
  const [status, setStatus] = useState('awaiting_admin');
  const { data, reload } = useApi(`/admin/activations${status ? `?status=${status}` : ''}`);
  const [error, setError] = useState('');

  const act = async (a, action) => {
    const verb = action === 'confirm' ? 'confirm sending for' : 'reject the run for';
    if (!window.confirm(`Really ${verb} ${a.userName}?`)) return;
    try {
      await api(`/admin/activations/${a.id}/${action}`, { method: 'POST' });
      setError('');
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1>Admin: notification runs</h1>
      <Alert>{error}</Alert>
      <label htmlFor="astatus">Show </label>
      <select id="astatus" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="awaiting_admin">Waiting for confirmation</option>
        <option value="awaiting_trustee">Waiting for an emergency contact</option>
        <option value="checkin_pending">Check-in pending</option>
        <option value="scheduled">Scheduled</option>
        <option value="">All</option>
      </select>
      <div className="card">
        <table>
          <thead><tr><th>User</th><th>Started</th><th>Status</th><th>Sends at</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data?.activations.map((a) => (
              <tr key={a.id}>
                <td>{a.userName}<br /><span className="muted">{a.userEmail}</span></td>
                <td>{formatDateTime(a.createdAt)}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>{formatDateTime(a.dispatchAt)}</td>
                <td className="right">
                  {a.status === 'awaiting_admin' && <button className="btn btn-danger" onClick={() => act(a, 'confirm')}>Confirm</button>}
                  {['awaiting_admin', 'checkin_pending', 'scheduled'].includes(a.status) && <button className="btn" onClick={() => act(a, 'reject')}>Reject</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.activations.length === 0 && <p className="muted">Nothing here.</p>}
      </div>
    </>
  );
}
