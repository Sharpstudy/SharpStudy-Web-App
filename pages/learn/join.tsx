import { Join } from "@/learn-together/client/kid/Kid";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("join");
export default Join;
