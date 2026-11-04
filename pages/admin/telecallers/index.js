// /admin/telecallers/ is only the group link in the sidebar: it opens the first sub-section. Visitors who are not admins
// never get here: pages/_app.js (the admin page gate) has already answered their request, and this does nothing then.
export default function TelecallersIndex() {
	return null;
}

export async function getServerSideProps({ res }) {
	if (res.headersSent || res.writableEnded) return { props: {} };
	return { redirect: { destination: "/admin/telecallers/applications/", permanent: false } };
}
