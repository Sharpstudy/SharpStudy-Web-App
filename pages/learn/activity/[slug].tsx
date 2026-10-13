import ActivityPreview from "@/learn-together/client/parent/ActivityPreview";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default ActivityPreview;
