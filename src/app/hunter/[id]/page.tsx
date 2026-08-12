import { Dossier } from "@/components/dossier";
export const dynamic="force-dynamic";
export default async function HunterPage({params}:{params:Promise<{id:string}>}){return <Dossier id={(await params).id} type="player"/>;}
