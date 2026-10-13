import dynamic from "next/dynamic";
import { gate } from "@/learn-together/server/page";

// Admin is lazy-loaded so its editor code never ships to parents or child devices.
const Metrics = dynamic(() => import("@/learn-together/client/admin/Admin").then((m) => m.Metrics), { ssr: false });

export const getServerSideProps = gate("admin", ["lt_admin"]);
export default Metrics;
