import { InvitePage } from "@/learn-together/client/parent/Privacy";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default InvitePage;
