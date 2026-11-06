import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type Entity = {
  id: string;
  owner: string;
  kind: string;
  created: number;
  [key: string]: any;
};
export class Fault extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireThat(
  ok: unknown,
  code: string,
  message: string,
  status = 400,
): asserts ok {
  if (!ok) throw new Fault(code, message, status);
}
export class Store {
  db: DatabaseSync;
  dir: string;
  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    this.db = new DatabaseSync(resolve(this.dir, "voice.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
    );
    this.db.exec(
      readFileSync(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    chmodSync(resolve(this.dir, "voice.sqlite"), 0o600);
  }
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  add(owner: string, kind: string, data: Record<string, any>): Entity {
    const row = { ...data, id: randomUUID(), owner, kind, created: Date.now() };
    this.db
      .prepare("INSERT INTO records VALUES (?,?,?,?,?)")
      .run(row.id, owner, kind, JSON.stringify(row), row.created);
    return row;
  }
  get(owner: string, kind: string, id: string): Entity {
    const row = this.db
      .prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind=?")
      .get(id, owner, kind);
    requireThat(row, "not_found", "Private record not found.", 404);
    return JSON.parse(row.data as string);
  }
  list(owner: string, kind: string): Entity[] {
    return this.db
      .prepare(
        "SELECT data FROM records WHERE owner=? AND kind=? ORDER BY created,id",
      )
      .all(owner, kind)
      .map((r) => JSON.parse(r.data as string));
  }
  save(row: Entity) {
    this.db
      .prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind=?")
      .run(JSON.stringify(row), row.id, row.owner, row.kind);
    return row;
  }
  remove(owner: string, kind: string, id: string) {
    this.get(owner, kind, id);
    this.db
      .prepare("DELETE FROM records WHERE id=? AND owner=? AND kind=?")
      .run(id, owner, kind);
  }
  audit(owner: string, action: string, target: string) {
    this.add(owner, "audit", { action, target });
  }
  job(owner: string, kind: string, target: string) {
    this.db
      .prepare(
        "INSERT INTO jobs (id,owner,kind,target,created) VALUES (?,?,?,?,?)",
      )
      .run(randomUUID(), owner, kind, target, Date.now());
  }
  close() {
    this.db.close();
  }
}
