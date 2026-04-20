export interface PlanningDeskMatch {
  uuid: string;
  sport: string;
  scheduledAt: string;
  homeTeam: string;
  guestTeam: string;
  competitionName: string;
  gamedayScope: string | null;
  gamedayExternalId: string | null;
  gamedayId: string | null;
}

export interface BblMappedEvent {
  type: number;
  typeName: string;
  data: Record<string, unknown>;
  raw: unknown[];
}

export async function getPlanningDeskMatches(sport: string): Promise<PlanningDeskMatch[]> {
  const res = await fetch(`/api/planning-desk/matches?sport=${encodeURIComponent(sport)}`);
  if (!res.ok) throw new Error(`Failed to load matches: ${res.status}`);
  return res.json();
}
