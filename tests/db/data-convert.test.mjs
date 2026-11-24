// Value conversion and comparison rules of the data migration (scripts/db/lib/data-convert.mjs). Pure logic.
import test from "node:test";
import assert from "node:assert/strict";
import { ConversionError, kindOfPgType, toPgParam, canon, stableStringify, rowHash, rowKey, tableChecksum } from "../../scripts/db/lib/data-convert.mjs";

test("PostgreSQL types map to conversion kinds, unknown types are refused", () => {
	assert.equal(kindOfPgType("uuid"), "uuid");
	assert.equal(kindOfPgType("timestamp with time zone"), "timestamptz");
	assert.equal(kindOfPgType("timestamp(3) with time zone"), "timestamptz");
	assert.equal(kindOfPgType("character varying(255)"), "text");
	assert.equal(kindOfPgType("character(3)"), "char");
	assert.equal(kindOfPgType("jsonb"), "jsonb");
	assert.equal(kindOfPgType("real"), "real");
	assert.throws(() => kindOfPgType("numeric(10,2)"), ConversionError);
});

test("NULL stays NULL and the empty string stays the empty string", () => {
	for (const k of ["uuid", "boolean", "integer", "real", "timestamptz", "date", "jsonb", "bytea", "text"]) assert.equal(toPgParam(k, null), null);
	assert.equal(toPgParam("text", ""), "");
	assert.equal(toPgParam("char", ""), "");
});

test("booleans: only 0/1 are accepted", () => {
	assert.equal(toPgParam("boolean", 1), true);
	assert.equal(toPgParam("boolean", 0), false);
	assert.throws(() => toPgParam("boolean", 2), ConversionError);
});

test("UUIDs are validated, never altered", () => {
	const u = "0b1f6a5c-7a36-4b3d-9d2e-1f0a2b3c4d5e";
	assert.equal(toPgParam("uuid", u), u);
	assert.throws(() => toPgParam("uuid", "abc"), ConversionError);
	assert.throws(() => toPgParam("uuid", ""), ConversionError);
});

test("DATETIME becomes the same UTC instant; DATE stays plain text; invalid or zero dates are refused", () => {
	assert.equal(toPgParam("timestamptz", "2026-11-12 06:24:46"), "2026-11-12 06:24:46+00");
	assert.equal(toPgParam("timestamptz", "2026-11-12 06:24:46.123"), "2026-11-12 06:24:46.123+00");
	assert.equal(Date.parse("2026-11-12T06:24:46.123Z"), Date.parse("2026-11-12 06:24:46.123+00"), "same instant, not shifted by 5h30");
	assert.equal(toPgParam("date", "2026-11-12"), "2026-11-12");
	assert.throws(() => toPgParam("timestamptz", "0000-00-00 00:00:00"), ConversionError);
	assert.throws(() => toPgParam("date", "0000-00-00"), ConversionError);
	assert.throws(() => toPgParam("timestamptz", new Date()), ConversionError);
	assert.throws(() => toPgParam("date", "12/11/2026"), ConversionError);
});

test("JSON must be valid text (so SQL NULL and JSON null stay different); binary must be a Buffer; NUL is refused", () => {
	assert.equal(toPgParam("jsonb", '{"a":[1,2]}'), '{"a":[1,2]}');
	assert.equal(toPgParam("jsonb", "null"), "null");
	assert.equal(toPgParam("jsonb", null), null);
	assert.throws(() => toPgParam("jsonb", "{bad"), ConversionError);
	assert.throws(() => toPgParam("jsonb", { a: 1 }), ConversionError);
	const b = Buffer.from([0, 1, 2, 255]);
	assert.equal(toPgParam("bytea", b), b);
	assert.throws(() => toPgParam("bytea", "text"), ConversionError);
	assert.throws(() => toPgParam("text", "a\u0000b"), ConversionError);
	assert.equal(toPgParam("text", "நமஸ்காரம் 😀 'quote' \"dq\" \\ backslash"), "நமஸ்காரம் 😀 'quote' \"dq\" \\ backslash");
});

test("numbers: integers and finite floats only, no rounding or conversion of monetary values", () => {
	assert.equal(toPgParam("integer", 42), 42);
	assert.equal(toPgParam("real", 12.5), 12.5);
	assert.throws(() => toPgParam("integer", 1.5), ConversionError);
	assert.throws(() => toPgParam("real", Infinity), ConversionError);
});

test("canonical forms: representation differences vanish, real differences stay", () => {
	assert.equal(canon("uuid", "0B1F6A5C-7A36-4B3D-9D2E-1F0A2B3C4D5E", "mysql"), canon("uuid", "0b1f6a5c-7a36-4b3d-9d2e-1f0a2b3c4d5e", "pg"));
	assert.equal(canon("boolean", 1, "mysql"), canon("boolean", true, "pg"));
	assert.notEqual(canon("boolean", 0, "mysql"), canon("boolean", true, "pg"));
	assert.equal(canon("timestamptz", "2026-11-12 06:24:46.123", "mysql"), canon("timestamptz", new Date("2026-11-12T06:24:46.123Z"), "pg"));
	assert.notEqual(canon("timestamptz", "2026-11-12 06:24:46", "mysql"), canon("timestamptz", new Date("2026-11-12T00:54:46Z"), "pg"), "a 5h30 shift is detected");
	assert.equal(canon("date", "2026-11-12", "mysql"), canon("date", "2026-11-12", "pg"));
	assert.equal(canon("jsonb", '{"b":1,"a":[1,{"d":2,"c":3}]}', "mysql"), canon("jsonb", '{"a":[1,{"c":3,"d":2}],"b":1}', "pg"));
	assert.notEqual(canon("jsonb", '{"a":1}', "mysql"), canon("jsonb", '{"a":2}', "pg"));
	// scalar JSON values and JSON null are real JSON, SQL NULL is not
	assert.equal(canon("jsonb", '"claude-opus-5-5"', "mysql"), canon("jsonb", '"claude-opus-5-5"', "pg"));
	assert.equal(canon("jsonb", "null", "mysql"), canon("jsonb", "null", "pg"));
	assert.notEqual(canon("jsonb", "null", "mysql"), canon("jsonb", null, "pg"));
	assert.equal(canon("bytea", Buffer.from([1, 2, 3]), "mysql"), canon("bytea", Buffer.from([1, 2, 3]), "pg"));
	assert.notEqual(canon("bytea", Buffer.from([1, 2, 3]), "mysql"), canon("bytea", Buffer.from([1, 2, 4]), "pg"));
	assert.equal(canon("real", 12.3, "mysql"), canon("real", Math.fround(12.3), "pg"));
	assert.equal(canon("char", "inr", "mysql"), canon("char", "inr   ", "pg"));
	assert.equal(canon("text", "", "mysql"), "");
	assert.equal(canon("text", null, "mysql"), null);
	assert.notEqual(canon("text", "", "mysql"), canon("text", null, "pg"), "empty string and NULL are different values");
});

test("stable stringify ignores key order only", () => {
	assert.equal(stableStringify({ b: 1, a: { d: [1, 2], c: null } }), stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
	assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

test("row hashes, keys and table checksums", () => {
	const cols = ["id", "n", "j"];
	const kinds = ["uuid", "integer", "jsonb"];
	const my = { id: "0B1F6A5C-7A36-4B3D-9D2E-1F0A2B3C4D5E", n: 5, j: '{"x":1,"y":2}' };
	const pg = { id: "0b1f6a5c-7a36-4b3d-9d2e-1f0a2b3c4d5e", n: 5, j: '{"y": 2, "x": 1}' };
	assert.equal(rowHash(cols, kinds, my, "mysql"), rowHash(cols, kinds, pg, "pg"));
	assert.notEqual(rowHash(cols, kinds, my, "mysql"), rowHash(cols, kinds, { ...pg, n: 6 }, "pg"));
	assert.equal(rowKey(["id"], cols, kinds, my, "mysql"), rowKey(["id"], cols, kinds, pg, "pg"));
	assert.equal(tableChecksum(["b", "a", "c"]), tableChecksum(["c", "a", "b"]));
	assert.notEqual(tableChecksum(["a", "b"]), tableChecksum(["a", "c"]));
});
