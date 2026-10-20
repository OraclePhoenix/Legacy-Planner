import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client.js';

// Loads a GET endpoint and exposes reload() for after mutations.
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(path));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) : '';
