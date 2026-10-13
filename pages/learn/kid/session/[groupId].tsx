import { KidSession } from "@/learn-together/client/kid/Kid";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("kid");
export default KidSession;
