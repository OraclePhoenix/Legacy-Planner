import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks.js';
import { Alert, Field, Modal } from '../components/ui.jsx';

const EMPTY = { name: '', phone: '', relationship: '', priority: 2 };
const PRIORITY = { 1: 'First to notify', 2: 'Standard', 3: 'Later' };

export default function Contacts() {
  const { data, reload } = useApi('/contacts');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const open = (c) => { setEditing(c || 'new'); setForm(c ? { ...c, relationship: c.relationship || '' } : EMPTY); setError(''); };

  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name, phone: form.phone, relationship: form.relationship || null, priority: Number(form.priority) };
    try {
      if (editing === 'new') await api('/contacts', { method: 'POST', body });
      else await api(`/contacts/${editing.id}`, { method: 'PATCH', body });
      setEditing(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.name}? They will be removed from every message.`)) return;
    await api(`/contacts/${c.id}`, { method: 'DELETE' });
    reload();
  };

  const importCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      setImportResult(await api('/contacts/import', { method: 'POST', body }));
      reload();
    } catch (err) {
      setImportResult({ imported: 0, errors: [{ row: '-', message: err.message }] });
    } finally {
      fileRef.current.value = '';
    }
  };

  const exportCsv = async () => {
    const res = await api('/contacts/export', { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'contacts.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head">
        <h1>Contacts</h1>
        <div className="actions">
          <label className="btn" htmlFor="csv">Import CSV</label>
          <input id="csv" ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={importCsv} />
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          <button className="btn btn-primary" onClick={() => open(null)}>Add contact</button>
        </div>
      </div>
      <p className="muted">CSV columns: name, phone, relationship, priority (1–3). Use international format like +14155550123.</p>
      {importResult && (
        <Alert kind={importResult.errors.length ? 'warning' : 'info'}>
          Imported {importResult.imported} contact(s).
          {importResult.errors.length > 0 && (
            <ul>{importResult.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
          )}
        </Alert>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Relationship</th><th>Priority</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data?.contacts.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.phone}</td><td>{c.relationship}</td><td>{PRIORITY[c.priority]}</td>
                <td className="right">
                  <button className="btn-link" onClick={() => open(c)}>Edit</button>
                  <button className="btn-link danger" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.contacts.length === 0 && <p className="muted">No contacts yet.</p>}
      </div>

      <Modal open={Boolean(editing)} title={editing === 'new' ? 'Add contact' : 'Edit contact'} onClose={() => setEditing(null)}>
        <form onSubmit={save}>
          <Alert>{error}</Alert>
          <Field label="Name" id="cname"><input id="cname" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Phone" id="cphone" hint="International format, e.g. +14155550123">
            <input id="cphone" type="tel" value={form.phone} onChange={set('phone')} required aria-describedby="cphone-hint" />
          </Field>
          <Field label="Relationship" id="crel"><input id="crel" value={form.relationship} onChange={set('relationship')} /></Field>
          <Field label="Priority" id="cpri">
            <select id="cpri" value={form.priority} onChange={set('priority')}>
              {[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
            </select>
          </Field>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
