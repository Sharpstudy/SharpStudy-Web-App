# SharpStudy bookstore

## Setup checklist (per environment; nothing runs automatically)
1. **Migration** (additive: creates `books`, `book_orders`, `book_progress` only): `npm run migrate`. Rollback: `npm run migrate:rollback`.
2. **Private file storage** (required on Vercel). Create a PRIVATE bucket on any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2, MinIO) and set:

   | Variable | Example |
   |---|---|
   | `BOOK_S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` or `https://s3.ap-south-1.amazonaws.com` |
   | `BOOK_S3_BUCKET` | `sharpstudy-books` |
   | `BOOK_S3_ACCESS_KEY_ID` / `BOOK_S3_SECRET_ACCESS_KEY` | a key limited to that bucket (read, write, delete) |
   | `BOOK_S3_REGION` | `ap-south-1` (AWS) or `auto` (R2) |

   Bucket CORS (so the browser can upload and read with signed URLs): allow your site origin, methods `GET, PUT, HEAD`, headers `Content-Type`.
   Keep the bucket private; the app only ever hands out signed URLs that expire in 2 minutes (reading) or 5 minutes (uploading).
   Without these variables: on Vercel every storage operation fails with a clear 503 (it will not write to the ephemeral disk);
   on a normal server it uses local disk (`BOOK_STORAGE_DIR`, default `./.book-storage`, which needs a persistent volume).
3. **Payments** reuse `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`. Book prices are **INR** (paise); the Stripe account must be able to charge INR.
   Add a Stripe webhook endpoint `POST /api/books/webhook` for `charge.succeeded`, `charge.failed`, `charge.refunded`, and set `STRIPE_WEBHOOK_SECRET`.
   Use Stripe **test mode** keys in development.

## Demo catalogue (development only)
21 fictional books (three per age group) with original sample PDFs and covers:

    npm run seed:books-demo

It needs the migration applied and `DB_*` development settings in `.env`. It refuses to run with `NODE_ENV=production`, on Vercel, or when the development
database is the same host and database as production. It only inserts rows that do not exist (matched by slug `demo-...`); re-running creates nothing,
and it never updates or deletes. Demo books show a "Demo" label in the store and the admin dashboard.

## Rules
- Prices are integer paise on the book row; the browser sends only which book and Stripe's token. Paid books cost INR 50 - 50,000; 0 = free.
- Access = a PAID `book_orders` row. `access_key` (`user:book`) is unique and set only while paid, so a duplicate purchase is impossible at the database level;
  a refund clears it and revokes access. Archiving a book keeps existing buyers' access and all order history.
- The protected PDF is delivered by `GET /api/books/[id]/access` (purchase checked on every call) -> same-origin stream, or a short-lived signed URL.
  Covers and the optional preview PDF are the only public files, and only for published books.
- Formats: PDF upload (<= 20 MB, content-sniffed) or an https external reading link. EPUB is not implemented. Sale prices are not supported (the pricing model has none).
- Age metadata: `min_age`/`max_age` and `grade_min`/`grade_max` are inclusive ranges; filters match on overlap, 18 belongs to both Senior Secondary and 18+,
  and "18+" is stored as maximum 120. Age is one recommendation signal alongside grade, subject and reading level (`lib/books/catalog.js`).
- Browser-side protection cannot make displayed content impossible to copy; upload only material you are licensed to sell.
