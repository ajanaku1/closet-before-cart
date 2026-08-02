import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const migrationUrl = new URL("../db/migrations/001_initial.sql", import.meta.url);

function dollarTagAt(sql, index) {
  return /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))?.[0];
}

function isTransactionBoundary(statement) {
  return /^(?:begin|commit)$/i.test(statement.trim());
}

class MigrationScanner {
  constructor(sql) {
    this.sql = sql;
    this.index = 0;
    this.buffer = "";
    this.statements = [];
    this.quote = undefined;
  }

  finishStatement() {
    const statement = this.buffer.trim();
    if (statement && !isTransactionBoundary(statement)) this.statements.push(statement);
    this.buffer = "";
  }

  consumeQuoted(quote) {
    const character = this.sql[this.index];
    this.buffer += character;
    if (character !== quote) return;
    if (this.sql[this.index + 1] === quote) {
      this.buffer += quote;
      this.index += 1;
      return;
    }
    this.quote = undefined;
  }

  consumeDollarQuote(tag) {
    if (!this.sql.startsWith(tag, this.index)) {
      this.buffer += this.sql[this.index];
      return;
    }
    this.buffer += tag;
    this.index += tag.length - 1;
    this.quote = undefined;
  }

  consumeLineComment() {
    const end = this.sql.indexOf("\n", this.index);
    const next = end === -1 ? this.sql.length : end + 1;
    this.buffer += this.sql.slice(this.index, next);
    this.index = next - 1;
  }

  consumeBlockComment() {
    const end = this.sql.indexOf("*/", this.index + 2);
    const next = end === -1 ? this.sql.length : end + 2;
    this.buffer += this.sql.slice(this.index, next);
    this.index = next - 1;
  }

  consumeUnquoted() {
    const character = this.sql[this.index];
    if (character === ";") return this.finishStatement();
    if (this.sql.startsWith("--", this.index)) return this.consumeLineComment();
    if (this.sql.startsWith("/*", this.index)) return this.consumeBlockComment();
    if (character === "'" || character === '"') this.quote = character;
    const dollarTag = character === "$" ? dollarTagAt(this.sql, this.index) : undefined;
    if (dollarTag) {
      this.quote = dollarTag;
      this.buffer += dollarTag;
      this.index += dollarTag.length - 1;
      return;
    }
    this.buffer += character;
  }

  scan() {
    for (; this.index < this.sql.length; this.index += 1) {
      if (this.quote?.startsWith("$")) this.consumeDollarQuote(this.quote);
      else if (this.quote) this.consumeQuoted(this.quote);
      else this.consumeUnquoted();
    }
    this.finishStatement();
    return this.statements;
  }
}

export function splitMigrationStatements(sql) {
  return new MigrationScanner(sql).scan();
}

async function verifySchema(sql) {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'style_cases', 'garment_items', 'commerce_quotes', 'style_proofs',
        'payment_attempts', 'processed_webhooks', 'audit_events'
      )
    order by table_name
  `;
  const triggers = await sql`
    select tgname as trigger_name
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'prevent_commerce_quote_update',
        'prevent_audit_event_update',
        'prevent_audit_event_delete'
      )
    order by tgname
  `;
  return {
    tables: tables.map(({ table_name }) => table_name),
    triggers: triggers.map(({ trigger_name }) => trigger_name),
  };
}

export async function applyInitialMigration(connectionString) {
  if (!connectionString) throw new Error("A Neon connection string is required");
  const migration = await readFile(migrationUrl, "utf8");
  const statements = splitMigrationStatements(migration);
  const sql = neon(connectionString);
  await sql.transaction(statements.map((statement) => sql.query(statement, [])));
  return verifySchema(sql);
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  const result = await applyInitialMigration(connectionString);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (executedPath === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
