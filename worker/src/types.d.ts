// общие типы окружения Cavalla
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  MINIAPP_URL: string;
}
export interface ScheduledEvent { }
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// минимальные типы Workers, чтобы не тащить @cloudflare/workers-types
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
  raw<T = unknown>(): Promise<T[]>;
}
declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(query: string): Promise<D1Result>;
  withSession(session: string | D1Session): D1Database;
}
declare interface D1Session { }

declare interface KVNamespace {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
