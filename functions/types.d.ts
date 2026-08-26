type D1ExecResult = {
  count?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  changed_db?: boolean;
  size_after?: number;
};

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta?: D1ExecResult;
};

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1ExecResult>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = D1ExecResult>(statements: D1PreparedStatement[]): Promise<T[]>;
};

type PagesEnv = {
  DB: D1Database;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
};

type PagesContext = {
  request: Request;
  params: Record<string, string>;
  env: PagesEnv;
};

type PagesFunction = (context: PagesContext) => Response | Promise<Response>;
