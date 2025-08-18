import axios from 'axios';
import type { PlayerRow, Solution } from './types';

export async function parseSheet(file: File, sheet?: string): Promise<PlayerRow[]> {
  const form = new FormData();
  form.append('file', file);
  if (sheet) form.append('sheet', sheet);

  const { data } = await axios.post<{ rows?: PlayerRow[]; error?: string }>(
    '/api/parse-sheet',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );

  if (data?.error) throw new Error(data.error);
  if (!data?.rows) throw new Error('Parse failed: no rows returned');
  return data.rows;
}

export async function optimize(players: PlayerRow[], budget: number, k: number): Promise<Solution[]> {
  const { data } = await axios.post<{ solutions?: Solution[]; error?: string }>(
    '/api/optimize',
    { players, budget, k }
  );

  if (data?.error) throw new Error(data.error);
  return data?.solutions ?? [];
}
