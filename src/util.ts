// Fehler und Eingabeprüfung – gemeinsam für App-API und MCP.

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

export function str(v: unknown, field: string, { min = 1, max = 200, optional = false } = {}): string {
  if (v === undefined || v === null) {
    if (optional) return '';
    return fail(400, `${field} fehlt.`);
  }
  if (typeof v !== 'string') return fail(400, `${field} muss Text sein.`);
  const s = v.trim();
  if (s.length < min) return fail(400, `${field} ist zu kurz (mindestens ${min} Zeichen).`);
  if (s.length > max) return fail(400, `${field} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
}

export function int(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return fail(400, `${field} muss eine ganze Zahl sein.`);
  return n;
}
