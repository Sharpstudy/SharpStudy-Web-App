import Onboarding from "@/learn-together/client/parent/Onboarding";
import { gate } from "@/learn-together/server/page";

export const getServerSideProps = gate("parent");
export default Onboarding;
