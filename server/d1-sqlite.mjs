import { DatabaseSync } from 'node:sqlite';

// Keep the D1 statement/batch contract while using a durable, local SQLite DB.
export class SQLiteD1 {
  constructor(filename) {
    this.sql = new DatabaseSync(filename);
    this.sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  }
  prepare(query) { return new SQLiteStatement(this, query, []); }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const results = statements.map(statement => {
        if (statement.database !== this) throw new Error('Statement belongs to another database');
        return statement.execute();
      });
      this.sql.exec('COMMIT');
      return results;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sql.close(); }
}

class SQLiteStatement {
  constructor(database, query, params) { this.database=database; this.query=query; this.params=params; }
  bind(...params) { return new SQLiteStatement(this.database, this.query, params); }
  async first(column) {
    const row=this.database.sql.prepare(this.query).get(...this.params);
    return row == null ? null : column == null ? row : row[column] ?? null;
  }
  async all() {
    return { success:true, results:this.database.sql.prepare(this.query).all(...this.params), meta:{} };
  }
  async run() { return this.execute(); }
  execute() {
    const statement=this.database.sql.prepare(this.query);
    if (/^\s*(?:SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(this.query))
      return { success:true, results:statement.all(...this.params), meta:{} };
    const result=statement.run(...this.params);
    return { success:true, results:[], meta:{ changes:Number(result.changes), last_row_id:Number(result.lastInsertRowid) } };
  }
}
