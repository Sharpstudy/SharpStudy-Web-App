# Application compatibility: MySQL and PostgreSQL

MySQL is the default. PostgreSQL is used when `DB_DIALECT=postgres` is set (see `database/connection.js`). The helpers live in `lib/db/`.

| Topic | MySQL (unchanged) | PostgreSQL |
|---|---|---|
| Upserts (`ml_daily_activity`, `ml_presence`) | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT (...) DO UPDATE` (`lib/db/statements.js`) |
| Lock row (`meeting_schedule_lock`) | `INSERT IGNORE` | `ON CONFLICT DO NOTHING` |
| "Now" in raw SQL | `UTC_TIMESTAMP()` | `CURRENT_TIMESTAMP` (timestamptz) |
| Retryable lock errors | errno 1213 / 1205 | SQLSTATE 40P01 / 55P03 / 40001 (`isLockRetryError`) |
| Duplicate key | `ER_DUP_ENTRY` / 1062 | 23505 (`isDuplicateError`) |
| Missing table / column | `ER_NO_SUCH_TABLE`, `ER_BAD_FIELD_ERROR` | 42P01 / 42703 (`dbErrors.js`, `isMissingTableError`) |
| Text search | `Op.like` (case-insensitive collation) | `Op.iLike` (`likeOp`) |
| E-mail / coupon code / meeting reference lookups | `{ column: value }` | `lower(column) = lower(value)` (`ciEquals`), backed by `uq_users_email_lower` |
| Stored e-mail | trimmed + lower-case on sign-up (both databases) | same |
| `ORDER BY rand()` | `rand()` | `random()` (`randomOrderSql`) |
| Malformed id in a lookup | finds nothing (404) | finds nothing: `lib/db/uuidGuard.js` (PostgreSQL only) |
| Raw SQL aliases | mixed-case alias kept | PostgreSQL folds unquoted aliases to lower case, so aliases are lower-case (`attemptStats`) |
| Seeder `key` column | quoted by `queryInterface.quoteIdentifier` | same code |

## Known differences that are accepted

* Slug lookups (`courses.slug`, `books.slug`, `categories.slug`, `quizzes.slug`) are exact-match on PostgreSQL; slugs are generated in lower case.
* `subscriptions.email` and other unique text columns are unique case-sensitively on PostgreSQL (only `users.email` has the case-insensitive index).
* `ORDER BY` on text columns follows the PostgreSQL database collation (`English_India.1252`), not MySQL's `utf8mb4_0900_ai_ci`.
* NULL ordering differs by default between the databases; every ordered nullable column was reviewed and none is affected today.
* The UUID guard only covers top-level `where` conditions (and nested `Op.and` / `Op.or`), not conditions inside `include`.
* A `RESTRICT` foreign-key violation is SQLSTATE `23001` on PostgreSQL (`23503` for the other rules).

## Preserving the 35 MySQL migration records (recommendation for Phase 5)

Do not insert them into the PostgreSQL `sequelizemeta` table: that table is the PostgreSQL migration history, and rows naming migrations that do not exist in `database/migrations-pg` would make `db:migrate:status` report 35 "unknown" entries and blur which migrations really built the PostgreSQL schema.

Copy them, unchanged, into a separate table created in the Phase 5 data migration, for example `mysql_migration_history (name varchar(255) primary key, copied_at timestamptz default now())`, and record the count (35) in the reconciliation report. The PostgreSQL schema was generated from the MySQL `information_schema`, so those 35 records describe the history of the source, not of the target.
