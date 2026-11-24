# MySQL to PostgreSQL data migration (Phase 5)

Tool: `scripts/db/migrate-mysql-to-postgres.mjs` (conversion rules in `scripts/db/lib/data-convert.mjs`, connections in `scripts/db/lib/migration-io.mjs`).
Independent check: `scripts/db/reconcile-mysql-postgres.mjs`. Both read credentials from the untracked `.env` (MySQL) and `pgpass.conf` (PostgreSQL); nothing is printed.

| Command | What it does |
|---|---|
| `yarn db:migrate-data` | **Audit only.** Read-only on both databases. Checks versions, tables, row counts, keys, orphans, schema equality, that PostgreSQL is empty, the backups' checksums, and converts every source row in memory. |
| `yarn db:migrate-data --rehearse` | The complete copy and verification inside a PostgreSQL transaction that is **always rolled back**. |
| `yarn db:migrate-data --execute` | The same run, **committed only if every check inside the transaction passed.** |
| `yarn db:reconcile` | Re-reads both databases with new connections and compares all 66 tables row by row, foreign keys, business totals, binary data, sequences, migration history, and that MySQL is unchanged. |

## Safety design

* **MySQL is only read**: one `READ ONLY` transaction with a consistent snapshot (every table is read as of the same instant); the server rejects any write on it. The tool reports the session's `Com_insert/update/delete/DDL` counters, which must all be 0.
* **PostgreSQL gets one all-or-nothing transaction.** Any failure rolls back everything, so there is never a partial copy to clean up and no resume, merge or overwrite mode exists. The tool refuses to run unless all 66 application tables are empty.
* Values are bound as parameters; nothing is concatenated into SQL. Parents are inserted before children (dependency order), so no constraint is disabled or deferred.
* Before `COMMIT`, every inserted row is read back and compared with the source (row count, primary keys, a canonical hash of every column). One difference rolls the transaction back.
* Conversions: `CHAR(36)` -> uuid (validated, unchanged); `DATETIME` -> timestamptz as the same UTC instant (`value + 00`); `DATE` stays a plain date string; JSON travels as raw text into jsonb; `BLOB` as a Buffer into bytea; `TINYINT(1)` 0/1 -> boolean; `FLOAT` -> real unchanged (no rounding, no numeric conversion of money). A value that does not fit stops the run.

## Migration history

The 35 migration names applied to the original MySQL database are copied, in their original order, into the **separate** table `mysql_migration_history (id, name, copied_at)` (DDL in `database/migrations-pg/sql/data-migration-history.sql`, created inside the same transaction). PostgreSQL's own `sequelizemeta` (the 4 PostgreSQL migrations) is not touched, and no MySQL migration is ever run against PostgreSQL. The table's identity sequence is set to 35 after the copy, so the next value is 36. It is the only sequence in the schema: all 66 application tables use UUID primary keys.

## Recovery plan

* **The run fails or is stopped:** nothing is kept (PostgreSQL rolled back). Read the reported table and primary key, fix the cause (source data, mapping or schema) and run the audit again. A retry is safe because the target is still empty.
* **The run committed but a later check fails:** do not edit data by hand and do not re-run `--execute` (the tool will refuse, because the tables are not empty). Stop and decide explicitly how to proceed; the options are (a) correct the specific difference found by `yarn db:reconcile`, or (b) a separately approved procedure that empties the PostgreSQL application tables and repeats the migration from the verified MySQL backup.
* **Going back to MySQL** needs no data action: MySQL was never modified and is still the default (`DB_DIALECT` unset). Backups are in `..\SharpStudy-DB-Backups` with SHA-256 files; they are read-only and are never overwritten.
