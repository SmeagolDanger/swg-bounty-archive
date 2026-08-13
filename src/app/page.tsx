import type { Metadata } from "next";
import EncountersPage from "./encounters/page";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Encounter archive", ...(siteUrl() ? { alternates: { canonical: "/" } } : {}) };
export const dynamic = "force-dynamic";

export default EncountersPage;
