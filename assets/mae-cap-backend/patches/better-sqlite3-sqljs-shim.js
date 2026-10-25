/**
 * better-sqlite3 shim — uses sql.js (pure WASM) via Worker + MessageChannel.
 *
 * Installed by postinstall script to replace native better-sqlite3 bindings
 * with a pure-JS sql.js implementation. Works on any platform without
 * native compilation (no make/g++ required).
 *
 * Supports the full @cap-js/sqlite API:
 *   new Database(path?)
 *   db.function(name, [opts,] fn)   ← sql.js create_function
 *   db.prepare(sql) → { run, get, all, iterate }
 *   db.exec(sql)
 *   db.transaction(fn)
 *   db.pragma(stmt)
 *   db.close()
 *   db.open (getter)
 *   db.memory (getter)
 */

'use strict';

const { Worker, receiveMessageOnPort, MessageChannel } = require('worker_threads');
const fs = require('fs');

// ── SqliteError ────────────────────────────────────────────────────────────
class SqliteError extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'SqliteError';
    this.code = code || 'SQLITE_ERROR';
  }
}

// ── Worker source (eval string) ────────────────────────────────────────────
const WORKER_SRC = `
'use strict';
const { workerData } = require('worker_threads');
const port = workerData.port;
const fs   = require('fs');
const initSqlJs  = require(workerData.sqlJsPath);
const wasmBinary = fs.readFileSync(workerData.wasmPath);

let db;
initSqlJs({ wasmBinary }).then(SQL => {
  db = workerData.fileData && workerData.fileData.length > 0
    ? new SQL.Database(Buffer.from(workerData.fileData))
    : new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  port.postMessage({ type: 'ready' });
});

port.on('message', (msg) => {
  let reply;
  try {
    switch (msg.type) {
      case 'register_function': {
        // eslint-disable-next-line no-eval
        db.create_function(msg.name, eval('(' + msg.fnSrc + ')'));
        reply = { ok: true };
        break;
      }
      case 'exec':
        db.run(msg.sql);
        reply = { ok: true };
        break;
      case 'run':
        db.run(msg.sql, msg.params || null);
        reply = { ok: true, changes: db.getRowsModified() };
        break;
      case 'get': {
        const s = db.prepare(msg.sql);
        if (msg.params && msg.params.length) s.bind(msg.params);
        const hit = s.step();
        const row = hit ? s.getAsObject() : null;
        s.free();
        reply = { ok: true, row };
        break;
      }
      case 'all': {
        const res = db.exec(msg.sql, msg.params || null);
        if (!res || res.length === 0) { reply = { ok: true, rows: [] }; break; }
        const { columns, values } = res[0];
        reply = { ok: true, rows: values.map(r => {
          const o = {}; columns.forEach((c, i) => { o[c] = r[i]; }); return o;
        })};
        break;
      }
      case 'export': {
        const data = db.export();
        reply = { ok: true, data: Buffer.from(data) };
        break;
      }
      case 'begin':    db.run('BEGIN');    reply = { ok: true }; break;
      case 'commit':   db.run('COMMIT');   reply = { ok: true }; break;
      case 'rollback': db.run('ROLLBACK'); reply = { ok: true }; break;
      case 'close':    db.close();         reply = { ok: true }; break;
      default: reply = { ok: false, err: 'Unknown op: ' + msg.type };
    }
  } catch (e) {
    reply = { ok: false, err: e.message };
  }
  port.postMessage(reply);
});
`;

let sqlJsPath;
let wasmPath;
try {
  sqlJsPath = require.resolve('sql.js');
  wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm');
} catch (e) {
  throw new Error('sql.js not found. Run: npm install sql.js');
}

// ── Global open-db registry for process.exit persistence ──────────────────
const _openDbs = new Set();
function _saveAll() { for (const db of _openDbs) { try { db._saveToFile(); } catch {} } }
process.on('exit', _saveAll);
process.on('SIGTERM', () => { _saveAll(); process.exit(0); });
process.on('SIGINT',  () => { _saveAll(); process.exit(0); });

// ── Database ───────────────────────────────────────────────────────────────
class Database {
  constructor(filename, _opts) {
    this.name   = filename || ':memory:';
    this.memory = !filename || filename === ':memory:';

    let fileData = null;
    if (!this.memory && fs.existsSync(this.name)) {
      fileData = Array.from(fs.readFileSync(this.name));
    }

    const { port1, port2 } = new MessageChannel();
    this._port     = port1;
    this._filename = this.memory ? null : this.name;

    this._worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { sqlJsPath, wasmPath, port: port2, fileData },
      transferList: [port2]
    });

    const ready = this._recv(10000);
    if (!ready || ready.type !== 'ready') {
      throw new SqliteError('sql.js worker did not become ready within 10s');
    }

    if (!this.memory) _openDbs.add(this);
  }

  /** Register a user-defined SQL function (better-sqlite3 compatible). */
  function(name, optsOrFn, fn) {
    const func = typeof optsOrFn === 'function' ? optsOrFn : fn;
    if (typeof func !== 'function') throw new TypeError(`Expected function for "${name}"`);
    this._send({ type: 'register_function', name, fnSrc: func.toString() });
    return this;
  }

  _saveToFile() {
    if (!this._filename) return;
    try {
      const r = this._send({ type: 'export' });
      if (r.data) fs.writeFileSync(this._filename, Buffer.from(r.data));
    } catch {}
  }

  _send(msg) {
    this._port.postMessage(msg);
    const reply = this._recv(15000);
    if (!reply)    throw new SqliteError('Worker timed out on: ' + msg.type);
    if (!reply.ok) throw new SqliteError(reply.err || 'Worker error on: ' + msg.type);
    return reply;
  }

  _recv(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = receiveMessageOnPort(this._port);
      if (m) return m.message;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
    return null;
  }

  prepare(sql) { return new Statement(this, sql); }

  exec(sql) {
    this._send({ type: 'exec', sql });
    return this;
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      self._send({ type: 'begin' });
      try   { const r = fn(...args); self._send({ type: 'commit' }); return r; }
      catch (e) { try { self._send({ type: 'rollback' }); } catch {} throw e; }
    };
  }

  pragma(stmt) {
    try { this._send({ type: 'exec', sql: `PRAGMA ${stmt}` }); } catch {}
    return [];
  }

  close() {
    try {
      this._saveToFile();
      _openDbs.delete(this);
      this._send({ type: 'close' });
      this._worker.terminate();
    } catch {}
  }

  get open()   { return true; }
}

// ── Statement ─────────────────────────────────────────────────────────────
class Statement {
  constructor(db, sql) { this._db = db; this._sql = sql; }

  run(...args) {
    const r = this._db._send({ type: 'run', sql: this._sql, params: _flat(args) });
    return { changes: r.changes || 0, lastInsertRowid: 0 };
  }
  get(...args) {
    const r = this._db._send({ type: 'get', sql: this._sql, params: _flat(args) });
    return r.row || undefined;
  }
  all(...args) {
    const r = this._db._send({ type: 'all', sql: this._sql, params: _flat(args) });
    return r.rows || [];
  }
  iterate(...args) {
    const rows = this.all(...args); let i = 0;
    return {
      [Symbol.iterator]() { return this; },
      next() { return i < rows.length ? { value: rows[i++], done: false } : { value: undefined, done: true }; },
      return() { return { done: true }; }
    };
  }
}

function _flat(args) {
  if (!args || args.length === 0) return null;
  if (args.length === 1 && Array.isArray(args[0])) return args[0].length ? args[0] : null;
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) return null;
  return args;
}

module.exports             = Database;
module.exports.SqliteError = SqliteError;
module.exports.default     = Database;
