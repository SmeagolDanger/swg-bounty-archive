import type { Metadata } from "next";
import { Dossier, loadParticipant } from "@/components/dossier";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await loadParticipant((await params).id, "player");
  return { title: data ? `${data.participant.current_name} · Hunter dossier` : "Hunter dossier" };
}

export default async function HunterPage({ params }: { params: Promise<{ id: string }> }) {
  return <Dossier id={(await params).id} type="player" />;
}
