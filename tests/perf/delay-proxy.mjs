// TCP proxy that adds a fixed one-way delay in both directions, to emulate a REMOTE database from a local test PostgreSQL (TLS passes through
// untouched, so certificate verification still happens end to end).
//   node tests/perf/delay-proxy.mjs <listenPort> <targetPort> <oneWayDelayMs>      localhost only
import net from "node:net";
const [, , LISTEN, TARGET, DELAY = "15"] = process.argv;
const d = Number(DELAY);
net.createServer((client) => {
	const server = net.connect(Number(TARGET), "127.0.0.1");
	const pipe = (from, to) => from.on("data", (b) => setTimeout(() => to.writable && to.write(b), d)).on("close", () => setTimeout(() => to.end(), d)).on("error", () => to.destroy());
	pipe(client, server); pipe(server, client);
	client.setNoDelay(true); server.setNoDelay(true);
}).listen(Number(LISTEN), "127.0.0.1", () => console.log(`delay proxy 127.0.0.1:${LISTEN} -> ${TARGET}, +${d} ms each way`));
