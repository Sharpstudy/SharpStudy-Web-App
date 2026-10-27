import Week from "@/learn-together/client/parent/Week";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Week;
