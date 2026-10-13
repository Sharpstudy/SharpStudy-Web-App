import Family from "@/learn-together/client/parent/Family";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Family;
