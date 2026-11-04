// telecaller_application_events.form_snapshot is added by migration 20261029000000. Until that migration has been applied
// the column does not exist, and a model query that names it would fail. These helpers keep the application working in
// BOTH states: when the column is absent it is never selected and never written (a submission still succeeds, it just has
// no snapshot), and as soon as it appears the code uses it. Pure: the schema lookup and the clock are passed in.
export const SNAPSHOT_COLUMN = "form_snapshot";

// Returns an async function: has the column been seen? A positive answer is remembered for good. A negative one is
// re-checked at most every `retryMs`, so applying the migration is picked up without a restart and a missing column
// does not cost a schema query on every request.
export function createColumnProbe(describe, { now = () => Date.now(), retryMs = 30000 } = {}) {
	let known = false;
	let checkedAt = -Infinity;
	return async function hasSnapshotColumn() {
		if (known) return true;
		if (now() - checkedAt < retryMs) return false;
		checkedAt = now();
		try {
			const columns = await describe();
			if (columns && Object.prototype.hasOwnProperty.call(columns, SNAPSHOT_COLUMN)) known = true;
		} catch (e) {
			/* unknown: behave as if the column is absent */
		}
		return known;
	};
}

// Sequelize `attributes` option for event reads.
export const eventAttributes = (has) => (has ? undefined : { exclude: [SNAPSHOT_COLUMN] });

// An event row ready to insert: the snapshot is dropped when the column is not there.
export function eventRow(event, has) {
	if (has || !event || !Object.prototype.hasOwnProperty.call(event, SNAPSHOT_COLUMN)) return event;
	const { [SNAPSHOT_COLUMN]: dropped, ...rest } = event;
	return rest;
}
