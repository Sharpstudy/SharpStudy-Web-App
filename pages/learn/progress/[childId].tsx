import Progress from "@/learn-together/client/parent/Progress";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Progress;
