/**
 * SqlJsAdapter – wraps sql.js (pure WASM) to provide a better-sqlite3-compatible
 * synchronous interface that @cap-js/sqlite expects.
 *
 * This allows running the full CAP stack on Node 26 without native compilation.
 */

'use strict';

let SQL = null;

/**
 * Lazily initialise sql.js and return the synchronous Database class.
 * sql.js returns a Promise on first load; subsequent calls return cached SQL.
 */
async function getSQLClass() {
  if (SQL) return SQL;
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  return SQL;
}

class SqlJsDatabase {
  constructor(db) {
    this._db = db;
  }

  // ── better-sqlite3-compatible API ────────────────────────────────────────

  prepare(sql) {
    const db = this._db;
    return {
      run: (...params) => {
        db.run(sql, this._flatParams(params));
        return { changes: db.getRowsModified() };
      },
      get: (...params) => {
        const stmt = db.prepare(sql);
        stmt.bind(this._flatParams(params));
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all: (...params) => {
        const results = db.exec(sql, this._flatParams(params));
        if (!results || results.length === 0) return [];
        const { columns, values } = results[0];
        return values.map(row => {
          const obj = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
      },
      iterate: (...params) => {
        const rows = this.prepare(sql).all(...params);
        let i = 0;
        return {
          [Symbol.iterator]() { return this; },
          next() {
            if (i < rows.length) return { value: rows[i++], done: false };
            return { value: undefined, done: true };
          }
        };
      },
      free() {}
    };
  }

  exec(sql) {
    this._db.run(sql);
    return this;
  }

  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN');
      try {
        const result = fn(...args);
        this._db.run('COMMIT');
        return result;
      } catch (e) {
        this._db.run('ROLLBACK');
        throw e;
      }
    };
  }

  pragma(stmt) {
    try { this._db.run(`PRAGMA ${stmt}`); } catch {}
    return [];
  }

  close() {
    this._db.close();
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  _flatParams(params) {
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    return params.length ? params : null;
  }
}

/**
 * Factory: returns a SqlJsDatabase instance (async, call once at startup).
 * @param {string} _url – path ignored; always in-memory for demo
 */
async function openDatabase(_url) {
  const SQL = await getSQLClass();
  const db  = new SQL.Database();
  // Enable WAL for better concurrent read performance
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  return new SqlJsDatabase(db);
}

module.exports = { openDatabase, SqlJsDatabase };
