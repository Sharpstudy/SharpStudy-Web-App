import Badges from "@/learn-together/client/kid/Badges";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("kid");
export default Badges;
