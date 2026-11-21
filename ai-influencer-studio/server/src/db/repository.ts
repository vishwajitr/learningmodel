import { randomUUID } from 'node:crypto';
import { db } from './sqlite.js';

/**
 * Storage-agnostic repository contract. The API layer only depends on this
 * interface; SqliteRepository is today's implementation and a MongoRepository
 * can implement the same methods later (all methods are async for that reason).
 */
export interface Repository<T extends { id: string }> {
  list(filter?: Partial<T>, opts?: ListOptions<T>): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  create(data: CreateInput<T>): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  delete(id: string): Promise<boolean>;
  count(filter?: Partial<T>): Promise<number>;
}

export interface ListOptions<T> {
  orderBy?: keyof T & string;
  direction?: 'asc' | 'desc';
  limit?: number;
}

export type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

type FieldType = 'text' | 'int' | 'real' | 'bool' | 'json';

export interface EntityDef<T> {
  table: string;
  /** Persisted fields (excluding id/createdAt/updatedAt). */
  fields: { [K in keyof T]?: FieldType };
  /** Fields computed by the API layer; ignored on write. */
  defaultOrder?: keyof T & string;
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const nowIso = () => new Date().toISOString();

export class SqliteRepository<T extends { id: string; createdAt?: string; updatedAt?: string }>
  implements Repository<T>
{
  private readonly columns: [string, string, FieldType][];

  constructor(private readonly def: EntityDef<T>) {
    this.columns = Object.entries(def.fields as Record<string, FieldType>).map(([field, type]) => [
      field,
      toSnake(field),
      type,
    ]);
  }

  private fromRow(row: Record<string, unknown>): T {
    const out: Record<string, unknown> = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
    for (const [field, col, type] of this.columns) {
      const v = row[col];
      if (v === null || v === undefined) out[field] = null;
      else if (type === 'json') out[field] = JSON.parse(String(v));
      else if (type === 'bool') out[field] = Boolean(v);
      else if (type === 'int' || type === 'real') out[field] = Number(v);
      else out[field] = v;
    }
    return out as T;
  }

  private toValue(type: FieldType, v: unknown): string | number | null {
    if (v === undefined || v === null) return null;
    if (type === 'json') return JSON.stringify(v);
    if (type === 'bool') return v ? 1 : 0;
    if (type === 'int') return Math.round(Number(v));
    if (type === 'real') return Number(v);
    return String(v);
  }

  private where(filter?: Partial<T>): { sql: string; params: (string | number | null)[] } {
    if (!filter) return { sql: '', params: [] };
    const parts: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      const colDef = key === 'id' ? ['id', 'id', 'text' as FieldType] : this.columns.find((c) => c[0] === key);
      if (!colDef) throw new Error(`Unknown filter field ${key} on ${this.def.table}`);
      if (value === null) parts.push(`${colDef[1]} IS NULL`);
      else {
        parts.push(`${colDef[1]} = ?`);
        params.push(this.toValue(colDef[2] as FieldType, value));
      }
    }
    return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
  }

  async list(filter?: Partial<T>, opts: ListOptions<T> = {}): Promise<T[]> {
    const { sql, params } = this.where(filter);
    const orderField = opts.orderBy ?? this.def.defaultOrder ?? 'createdAt';
    const orderCol = toSnake(orderField);
    const dir = opts.direction ?? (orderField === 'createdAt' || orderField === 'updatedAt' ? 'desc' : 'asc');
    const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
    const rows = db
      .prepare(`SELECT * FROM ${this.def.table} ${sql} ORDER BY ${orderCol} ${dir}${limit}`)
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.fromRow(r));
  }

  async get(id: string): Promise<T | undefined> {
    const row = db.prepare(`SELECT * FROM ${this.def.table} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  async create(data: CreateInput<T>): Promise<T> {
    const id = data.id ?? randomUUID();
    const ts = nowIso();
    const record = data as Record<string, unknown>;
    const cols = ['id', 'created_at', 'updated_at'];
    const values: (string | number | null)[] = [id, ts, ts];
    for (const [field, col, type] of this.columns) {
      if (record[field] === undefined) continue;
      cols.push(col);
      values.push(this.toValue(type, record[field]));
    }
    db.prepare(
      `INSERT INTO ${this.def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...values);
    return (await this.get(id))!;
  }

  async update(id: string, patch: Partial<T>): Promise<T | undefined> {
    const sets: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [nowIso()];
    const record = patch as Record<string, unknown>;
    for (const [field, col, type] of this.columns) {
      if (!(field in record) || record[field] === undefined) continue;
      sets.push(`${col} = ?`);
      values.push(this.toValue(type, record[field]));
    }
    const res = db.prepare(`UPDATE ${this.def.table} SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    if (res.changes === 0) return undefined;
    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    return db.prepare(`DELETE FROM ${this.def.table} WHERE id = ?`).run(id).changes > 0;
  }

  async count(filter?: Partial<T>): Promise<number> {
    const { sql, params } = this.where(filter);
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${this.def.table} ${sql}`).get(...params) as { n: number };
    return Number(row.n);
  }
}
