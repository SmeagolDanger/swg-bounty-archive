import type { Metadata } from "next";
import { Dossier, loadParticipant } from "@/components/dossier";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await loadParticipant((await params).id, "guild");
  return { title: data ? `${data.participant.current_name} · Guild dossier` : "Guild dossier" };
}

export default async function GuildPage({ params }: { params: Promise<{ id: string }> }) {
  return <Dossier id={(await params).id} type="guild" />;
}
