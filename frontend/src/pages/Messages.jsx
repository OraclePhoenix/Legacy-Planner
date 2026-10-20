import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks.js';
import { Alert, Field, Modal } from '../components/ui.jsx';

const EMPTY = { name: '', body: '', contactIds: [] };

export default function Messages() {
  const templates = useApi('/templates');
  const contacts = useApi('/contacts');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const byId = Object.fromEntries((contacts.data?.contacts || []).map((c) => [c.id, c]));
  const open = (t) => { setEditing(t || 'new'); setForm(t ? { name: t.name, body: t.body, contactIds: t.contactIds } : EMPTY); setError(''); };
  const toggleRecipient = (id) => setForm({
    ...form, contactIds: form.contactIds.includes(id) ? form.contactIds.filter((x) => x !== id) : [...form.contactIds, id],
  });

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing === 'new') await api('/templates', { method: 'POST', body: form });
      else await api(`/templates/${editing.id}`, { method: 'PATCH', body: form });
      setEditing(null);
      templates.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete the message "${t.name}"?`)) return;
    await api(`/templates/${t.id}`, { method: 'DELETE' });
    templates.reload();
  };

  const preview = (form.body || '').replace(/\{\{\s*name\s*\}\}/gi, byId[form.contactIds[0]]?.name || 'Alex');

  return (
    <>
      <div className="page-head">
        <h1>Messages</h1>
        <button className="btn btn-primary" onClick={() => open(null)}>Write a message</button>
      </div>
      <p className="muted">Write what each person should receive. Use {'{{name}}'} to insert the recipient's name.</p>
      {templates.data?.templates.map((t) => (
        <section key={t.id} className="card">
          <div className="page-head">
            <h2>{t.name}</h2>
            <div>
              <button className="btn-link" onClick={() => open(t)}>Edit</button>
              <button className="btn-link danger" onClick={() => remove(t)}>Delete</button>
            </div>
          </div>
          <p className="message-body">{t.body}</p>
          <p className="muted">To: {t.contactIds.map((id) => byId[id]?.name).filter(Boolean).join(', ') || 'nobody yet'}</p>
        </section>
      ))}
      {templates.data?.templates.length === 0 && <p className="muted">No messages yet.</p>}

      <Modal open={Boolean(editing)} title={editing === 'new' ? 'Write a message' : 'Edit message'} onClose={() => setEditing(null)}>
        <form onSubmit={save}>
          <Alert>{error}</Alert>
          <Field label="Label (only you see this)" id="tname"><input id="tname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="Message" id="tbody" hint={`${form.body.length}/1600 characters`}>
            <textarea id="tbody" rows={6} maxLength={1600} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required aria-describedby="tbody-hint" />
          </Field>
          <fieldset>
            <legend>Recipients</legend>
            {contacts.data?.contacts.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={form.contactIds.includes(c.id)} onChange={() => toggleRecipient(c.id)} /> {c.name} <span className="muted">{c.phone}</span>
              </label>
            ))}
            {contacts.data?.contacts.length === 0 && <p className="muted">Add contacts first.</p>}
          </fieldset>
          {form.body && <div className="preview"><strong>Preview:</strong> {preview}</div>}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
