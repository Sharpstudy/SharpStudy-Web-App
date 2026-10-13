import dynamic from "next/dynamic";
import { gate } from "@/learn-together/server/page";

// Admin is lazy-loaded so its editor code never ships to parents or child devices.
const AdminEditor = dynamic(() => import("@/learn-together/client/admin/Admin").then((m) => m.AdminEditor), { ssr: false });

export const getServerSideProps = gate("admin", ["lt_editor", "lt_reviewer"]);
export default AdminEditor;
