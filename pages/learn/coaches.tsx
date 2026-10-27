import Coaches from "@/learn-together/client/parent/Coaches";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Coaches;
