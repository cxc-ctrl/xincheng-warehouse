import { SQLiteD1 } from './d1-sqlite.mjs';

let database: SQLiteD1 | undefined;
export const env = {
  get DB(): D1Database {
    const filename=process.env.WAREHOUSE_DATABASE;
    if(!filename) throw new Error('WAREHOUSE_DATABASE is required for self-hosting');
    database ??= new SQLiteD1(filename);
    return database as unknown as D1Database;
  },
};
