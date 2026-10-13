import Explore from "@/learn-together/client/parent/Explore";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Explore;
