import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi, formatDate } from '../hooks.js';
import { Alert, Field, Modal } from '../components/ui.jsx';

const CATEGORIES = ['legal', 'financial', 'personal', 'medical', 'digital', 'other'];
const EMPTY = { title: '', category: 'personal', priority: 'medium', dueDate: '', notes: '' };

export default function Checklist() {
  const { data, reload } = useApi('/checklist');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const open = (item) => {
    setEditing(item || 'new');
    setForm(item ? { ...EMPTY, ...item, dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '', notes: item.notes || '' } : EMPTY);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    const body = { title: form.title, category: form.category, priority: form.priority, dueDate: form.dueDate || null, notes: form.notes || null };
    try {
      if (editing === 'new') await api('/checklist', { method: 'POST', body });
      else await api(`/checklist/${editing.id}`, { method: 'PATCH', body });
      setEditing(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggle = async (item) => {
    await api(`/checklist/${item.id}`, { method: 'PATCH', body: { status: item.status === 'completed' ? 'pending' : 'completed' } });
    reload();
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await api(`/checklist/${item.id}`, { method: 'DELETE' });
    reload();
  };

  const items = data?.items || [];
  return (
    <>
      <div className="page-head">
        <h1>Checklist</h1>
        <button className="btn btn-primary" onClick={() => open(null)}>Add task</button>
      </div>
      {CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((category) => (
        <section key={category} className="card">
          <h2 className="cap">{category}</h2>
          <ul className="list">
            {items.filter((i) => i.category === category).map((item) => (
              <li key={item.id} className={item.status === 'completed' ? 'done' : ''}>
                <input type="checkbox" id={`chk-${item.id}`} checked={item.status === 'completed'} onChange={() => toggle(item)} />
                <label htmlFor={`chk-${item.id}`} className="grow">
                  <span className={`dot dot-${item.priority}`} aria-label={`${item.priority} priority`} /> {item.title}
                  {item.dueDate && <span className="muted"> · due {formatDate(item.dueDate)}</span>}
                  {item.notes && <span className="notes">{item.notes}</span>}
                </label>
                <button className="btn-link" onClick={() => open(item)}>Edit</button>
                <button className="btn-link danger" onClick={() => remove(item)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data && items.length === 0 && <p className="muted">No tasks yet.</p>}

      <Modal open={Boolean(editing)} title={editing === 'new' ? 'Add task' : 'Edit task'} onClose={() => setEditing(null)}>
        <form onSubmit={save}>
          <Alert>{error}</Alert>
          <Field label="Title" id="title"><input id="title" value={form.title} onChange={set('title')} required /></Field>
          <div className="row">
            <Field label="Category" id="category">
              <select id="category" value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Priority" id="priority">
              <select id="priority" value={form.priority} onChange={set('priority')}>
                {['low', 'medium', 'high'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Due date" id="due"><input id="due" type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
          </div>
          <Field label="Notes" id="notes"><textarea id="notes" rows={3} value={form.notes} onChange={set('notes')} /></Field>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
