import Controller from "@/learn-together/client/parent/Controller";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Controller;
