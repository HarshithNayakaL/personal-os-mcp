import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../../security/src/index.js';
export class Audit {
  private constructor(
    private db: Database,
    private file: string,
  ) {}
  static async open(file: string) {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    db.run(
      'CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, timestamp TEXT, session TEXT, client TEXT, device TEXT, capability TEXT, action TEXT, parameters TEXT, status TEXT, duration INTEGER, approval TEXT, error TEXT)',
    );
    return new Audit(db, file);
  }
  record(r: {
    session: string;
    client: string;
    device: string;
    capability: string;
    parameters: unknown;
    status: string;
    duration: number;
    approval: string;
    error?: unknown;
  }) {
    this.db.run(
      'INSERT INTO audit(timestamp,session,client,device,capability,action,parameters,status,duration,approval,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        new Date().toISOString(),
        r.session,
        r.client,
        r.device,
        r.capability,
        r.capability,
        JSON.stringify(redact(r.parameters)),
        r.status,
        r.duration,
        r.approval,
        JSON.stringify(redact(r.error ?? null)),
      ],
    );
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.db.export());
    fs.renameSync(tmp, this.file);
  }
  search(limit = 50, query = '') {
    const stmt = this.db.prepare(
      'SELECT * FROM audit WHERE capability LIKE ? OR status LIKE ? OR device LIKE ? ORDER BY id DESC LIMIT ?',
    );
    stmt.bind([`%${query}%`, `%${query}%`, `%${query}%`, Math.min(200, Math.max(1, limit))]);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  }
  close() {
    this.db.close();
  }
}
