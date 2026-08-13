import type { Metadata } from "next";
import { Dossier, loadParticipant } from "@/components/dossier";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await loadParticipant((await params).id, "city");
  return { title: data ? `${data.participant.current_name} · City dossier` : "City dossier" };
}

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  return <Dossier id={(await params).id} type="city" />;
}
