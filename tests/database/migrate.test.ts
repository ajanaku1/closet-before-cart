import assert from "node:assert/strict";
import test from "node:test";

const migrationModule = await import("../../scripts/migrate.mjs").catch(() => ({}));

function splitMigrationStatements(sql: string): string[] {
  assert.equal(
    typeof migrationModule.splitMigrationStatements,
    "function",
    "migration statement splitter must exist",
  );
  return migrationModule.splitMigrationStatements(sql) as string[];
}

test("splits ordinary migration statements", () => {
  assert.deepEqual(
    splitMigrationStatements("begin; create table example (id integer); commit;"),
    ["create table example (id integer)"],
  );
});

test("preserves semicolons inside dollar-quoted function bodies", () => {
  const sql = `
    create function example() returns trigger language plpgsql as $$
    begin
      raise exception 'blocked';
    end;
    $$;
    create trigger example_trigger before update on example
    for each row execute function example();
  `;

  const statements = splitMigrationStatements(sql);

  assert.equal(statements.length, 2);
  assert.match(statements[0] ?? "", /raise exception 'blocked';/);
  assert.match(statements[1] ?? "", /^create trigger example_trigger/);
});

test("does not split semicolons inside quoted strings or comments", () => {
  const sql = `
    -- this comment contains ; punctuation
    insert into example (value) values ('one;two');
    /* block ; comment */
    select "semi;colon" from example;
  `;

  const statements = splitMigrationStatements(sql);

  assert.equal(statements.length, 2);
  assert.match(statements[0] ?? "", /'one;two'/);
  assert.match(statements[1] ?? "", /"semi;colon"/);
});
