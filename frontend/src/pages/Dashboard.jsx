import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, formatDateTime } from '../hooks.js';
import { ProgressBar, StatusBadge } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const summary = useApi('/checklist/summary');
  const contacts = useApi('/contacts');
  const runs = useApi('/activations');
  const audit = useApi('/audit?limit=5');

  const current = runs.data?.current;
  return (
    <>
      <h1>Welcome, {user.name}</h1>
      {current && (
        <div className="alert alert-warning" role="status">
          A notification run is <strong>{current.status.replace(/_/g, ' ')}</strong>.{' '}
          <Link to="/send">Review or cancel it</Link>.
        </div>
      )}
      <div className="grid">
        <section className="card">
          <h2>Checklist progress</h2>
          {summary.data && (
            <>
              <ProgressBar label="Overall" value={summary.data.completed} total={summary.data.total} />
              {summary.data.byCategory.map((c) => (
                <ProgressBar key={c.category} label={c.category} value={c.completed} total={c.total} />
              ))}
              {summary.data.total === 0 && <p className="muted">No tasks yet. <Link to="/checklist">Add your first one</Link>.</p>}
            </>
          )}
        </section>
        <section className="card">
          <h2>Contacts</h2>
          <p className="stat">{contacts.data?.contacts.length ?? '–'}</p>
          <ul className="plain">
            {contacts.data?.contacts.slice(0, 5).map((c) => <li key={c.id}>{c.name} <span className="muted">· {c.relationship || 'contact'}</span></li>)}
          </ul>
          <Link to="/contacts">Manage contacts</Link>
        </section>
        <section className="card">
          <h2>Inactivity check</h2>
          {user.inactivityEnabled ? (
            <p>On. If you don't sign in for {user.inactivityDays} days we text you first, then wait {user.checkinGraceHours} hours before anything is scheduled.</p>
          ) : (
            <p className="muted">Off. Messages only go out if you send them yourself.</p>
          )}
          <Link to="/settings">Change settings</Link>
        </section>
        <section className="card">
          <h2>Recent activity</h2>
          <ul className="plain">
            {audit.data?.entries.map((e) => (
              <li key={e.id}><span className="muted">{formatDateTime(e.created_at)}</span> · {e.action}</li>
            ))}
          </ul>
          <Link to="/activity">Full activity log</Link>
        </section>
      </div>
      {runs.data?.activations.length > 0 && (
        <p className="muted">Last run: <StatusBadge status={runs.data.activations[0].status} /> {formatDateTime(runs.data.activations[0].createdAt)}</p>
      )}
    </>
  );
}
