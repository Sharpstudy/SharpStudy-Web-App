import Shop from "@/learn-together/client/parent/Shop";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Shop;
