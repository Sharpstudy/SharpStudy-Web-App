import Reflections from "@/learn-together/client/kid/Reflections";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("kid");
export default Reflections;
