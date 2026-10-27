import ReviewGarden from "@/learn-together/client/kid/ReviewGarden";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("kid");
export default ReviewGarden;
