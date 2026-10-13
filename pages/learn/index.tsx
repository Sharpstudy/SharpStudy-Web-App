import Home from "@/learn-together/client/parent/Home";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Home;
