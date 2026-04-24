// Helpers de formatacao BR

export function brl(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'R$ 0,00';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function int(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const n = typeof value === 'number' ? value : Number(value);
  return n.toLocaleString('pt-BR');
}

export function relativeTime(date: Date | string | null): string {
  if (!date) return 'nunca';
  const d = typeof date === 'string' ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d2 = Math.floor(h / 24);
  if (d2 < 30) return `há ${d2}d`;
  return d.toLocaleDateString('pt-BR');
}

/** Formata YYYY-MM-DD ou Date como DD/MM/YYYY. */
export function formatDate(date: Date | string | null): string {
  if (!date) return '—';
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return date.slice(0, 10).split('-').reverse().join('/');
    }
    return new Date(date).toLocaleDateString('pt-BR');
  }
  return date.toLocaleDateString('pt-BR');
}

export function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function maskCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

/**
 * Status da sincronizacao baseado no ultimo ping.
 * - online: <= 30 min
 * - warn: 30 min < x <= 2h
 * - offline: > 2h
 * - never: nunca pingou
 */
export type StatusSync = 'online' | 'warn' | 'offline' | 'never';

export function statusFromPing(ping: Date | string | null): StatusSync {
  if (!ping) return 'never';
  const d = typeof ping === 'string' ? new Date(ping) : ping;
  const min = (Date.now() - d.getTime()) / 60_000;
  if (min <= 30) return 'online';
  if (min <= 120) return 'warn';
  return 'offline';
}
