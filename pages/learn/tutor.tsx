import TutorDashboard from "@/learn-together/client/parent/TutorDashboard";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default TutorDashboard;
