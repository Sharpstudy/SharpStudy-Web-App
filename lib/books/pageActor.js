// Server-side helpers for the bookstore pages (getServerSideProps). The signed-in account is resolved
// from the signed cookie and the database exactly like the API does; the browser never supplies a role.
import { getAccountActor } from "@/lib/mastery-server/http";
import repo from "./repo";
import { bookDetail, homeSections } from "./service";

export const actorFromReq = (req) => {
	const token = req.cookies && req.cookies.edmy_users_token;
	return token ? getAccountActor({ headers: { authorization: token } }).catch(() => null) : null;
};

// getServerSideProps props must be JSON: drop undefined values.
export const plainProps = (data) => JSON.parse(JSON.stringify(data));

export const loadDetail = async (req, slug) => {
	const actor = await actorFromReq(req);
	try {
		return { actor, data: plainProps(await bookDetail(repo, actor, slug)) };
	} catch (e) {
		if (e && e.status === 404) return { actor, data: null };
		throw e;
	}
};

// The homepage must never break because the bookstore tables are not there yet or a query fails.
export const safeHomeSections = async (query = {}) => {
	try {
		return plainProps(await homeSections(repo, query));
	} catch (e) {
		console.error(`[books] home sections: ${e && e.message}`);
		return null;
	}
};
