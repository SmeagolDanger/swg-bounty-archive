import type { Metadata } from "next";
import { Dossier, loadParticipant } from "@/components/dossier";
import { parseHistoryQuery } from "@/components/hunter-history";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadParticipant((await params).id, "player");
  return { title: data ? `${data.participant.current_name} · Hunter dossier` : "Hunter dossier" };
}

export default async function HunterPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <Dossier id={id} type="player" historyFilters={parseHistoryQuery(query)}/>;
}
