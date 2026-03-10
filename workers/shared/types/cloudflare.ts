/**
 * Minimal Cloudflare Workers binding type definitions for Deno compatibility.
 *
 * The `@cloudflare/workers-types` npm package has broken binary exports that
 * Deno cannot resolve. These local declarations provide the subset of types
 * needed by this project. Full runtime implementations are injected by the
 * Cloudflare Workers platform.
 */

// ---------------------------------------------------------------------------
// D1 (SQL database)
// ---------------------------------------------------------------------------

export declare abstract class D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
  dump(): Promise<ArrayBuffer>;
}

export declare abstract class D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown>;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// R2 (object storage)
// ---------------------------------------------------------------------------

export declare abstract class R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | null
      | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata?: R2HTTPMetadata;
  readonly customMetadata?: Record<string, string>;
  readonly storageClass: string;
}

export interface R2ObjectBody extends R2Object {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  md5?: string;
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  include?: string[];
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

/** Cloudflare Queue binding. Body is the message payload type. */
export interface Queue<Body = unknown> {
  send(message: Body, options?: QueueSendOptions): Promise<void>;
  sendBatch(
    messages: Iterable<MessageSendRequest<Body>>,
    options?: QueueSendBatchOptions,
  ): Promise<void>;
}

export interface QueueSendOptions {
  contentType?: "text" | "bytes" | "json" | "v8";
  delaySeconds?: number;
}

export interface QueueSendBatchOptions {
  delaySeconds?: number;
}

export interface MessageSendRequest<Body = unknown> {
  body: Body;
  contentType?: "text" | "bytes" | "json" | "v8";
  delaySeconds?: number;
}
