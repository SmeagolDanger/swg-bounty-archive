import type { Metadata } from "next";
import EncountersPage from "./encounters/page";

export const metadata: Metadata = { title: "Encounter archive" };
export const dynamic = "force-dynamic";

export default EncountersPage;
