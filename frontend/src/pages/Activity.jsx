import { useState } from 'react';
import { useApi, formatDateTime } from '../hooks.js';

const LIMIT = 25;

export default function Activity() {
  const [page, setPage] = useState(1);
  const { data } = useApi(`/audit?page=${page}&limit=${LIMIT}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <>
      <h1>Activity log</h1>
      <p className="muted">Every sign-in, setting change and notification step is recorded here and cannot be edited.</p>
      <div className="card">
        <table>
          <thead><tr><th>When</th><th>Event</th><th>By</th><th>Details</th></tr></thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.created_at)}</td>
                <td>{e.action}</td>
                <td>{e.actor_name || 'System'}</td>
                <td><code>{Object.keys(e.details).length ? JSON.stringify(e.details) : ''}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        <nav className="actions" aria-label="Pagination">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      </div>
    </>
  );
}
