/**
 * Client für die Planning Desk API — holt kuratierte Spielpläne, Clubs und Competitions.
 * Wird für das Kommentator-Dropdown verwendet.
 */

export interface PlanningDeskMatch {
  uuid: string;
  sport: string;
  scheduledAt: string;
  competition: string | null;
  homeSide: string | null;
  awaySide: string | null;
  metadata: {
    gamedayId: string | null;
    externalDataProvider: string | null;
    externalDataProviderId: string | null;
  };
}

export interface PlanningDeskClub {
  uuid: string;
  sport: string;
  name: string;
  venue: string | null;
}

export interface PlanningDeskCompetition {
  uuid: string;
  sport: string;
  name: string;
  metadata: {
    gamedayId: string | null;
    externalDataProvider: string | null;
    externalDataProviderId: string | null;
  };
}

interface PaginatedResponse<T> {
  totalHits: number;
  currentPage: number;
  totalPages: number;
  limit: number;
  items: T[];
}

/** Aufbereitetes Match für das Frontend-Dropdown */
export interface ResolvedMatch {
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

/**
 * Resolves entity names (clubs or competitions) from a UUID→name map.
 * Exported as a standalone pure function for Property 7 testing.
 */
export function resolveEntityNames(
  entities: Array<{ uuid: string; name: string }>,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const entity of entities) {
    cache.set(entity.uuid, entity.name);
  }
  return cache;
}

/**
 * Filters and sorts resolved matches:
 * - Only matches with externalDataProvider != null and externalDataProviderId != null
 * - Only matches with scheduledAt >= today (start of day UTC)
 * - Sorted ascending by scheduledAt
 *
 * Exported as a standalone pure function for Property 8 testing.
 */
export function filterAndSortMatches(
  matches: ResolvedMatch[],
  today: Date = new Date(),
): ResolvedMatch[] {
  const todayStart = new Date(today);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return matches
    .filter(m =>
      m.gamedayScope != null &&
      m.gamedayExternalId != null &&
      new Date(m.scheduledAt).getTime() >= todayMs
    )
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export interface PlanningDeskClient {
  getMatches(sport: string): Promise<ResolvedMatch[]>;
  getMatch(uuid: string): Promise<PlanningDeskMatch>;
  getClubName(uuid: string): string;
}

export function createPlanningDeskClient(apiUrl: string, apiKey: string): PlanningDeskClient {
  async function apiFetch<T>(path: string): Promise<T> {
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
      headers: { 'x-api-auth-token-secret': apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Planning Desk API error: HTTP ${res.status}${body ? ` – ${body.slice(0, 200)}` : ''}`);
    }
    return res.json();
  }

  // Cache für Clubs und Competitions (werden selten geändert)
  const clubCache = new Map<string, string>();
  const competitionCache = new Map<string, string>();
  let clubsCachedForSport: string | null = null;
  let competitionsCachedForSport: string | null = null;

  async function loadAllClubs(sport: string): Promise<void> {
    if (clubsCachedForSport === sport && clubCache.size > 0) return;
    clubCache.clear();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await apiFetch<PaginatedResponse<PlanningDeskClub>>(
        `/sport/clubs?sport=${encodeURIComponent(sport)}&limit=50&page=${page}`
      );
      for (const club of data.items) {
        clubCache.set(club.uuid, club.name);
      }
      hasMore = page < data.totalPages;
      page++;
    }
    clubsCachedForSport = sport;
  }

  async function loadAllCompetitions(sport: string): Promise<void> {
    if (competitionsCachedForSport === sport && competitionCache.size > 0) return;
    competitionCache.clear();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await apiFetch<PaginatedResponse<PlanningDeskCompetition>>(
        `/sport/competitions?sport=${encodeURIComponent(sport)}&limit=50&page=${page}`
      );
      for (const comp of data.items) {
        competitionCache.set(comp.uuid, comp.name);
      }
      hasMore = page < data.totalPages;
      page++;
    }
    competitionsCachedForSport = sport;
  }

  return {
    async getMatches(sport: string): Promise<ResolvedMatch[]> {
      // Clubs und Competitions parallel vorladen
      await Promise.all([loadAllClubs(sport), loadAllCompetitions(sport)]);

      // Alle Matches laden (paginiert)
      const allMatches: PlanningDeskMatch[] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const data = await apiFetch<PaginatedResponse<PlanningDeskMatch>>(
          `/sport/matches?sport=${encodeURIComponent(sport)}&limit=200&page=${page}`
        );
        allMatches.push(...data.items);
        hasMore = page < data.totalPages;
        page++;
      }

      // Auflösen
      const resolved: ResolvedMatch[] = allMatches
        .filter(m => m.homeSide != null && m.awaySide != null)
        .map(m => ({
          uuid: m.uuid,
          sport: m.sport,
          scheduledAt: m.scheduledAt,
          homeTeam: clubCache.get(m.homeSide!) || 'Unbekannt',
          guestTeam: clubCache.get(m.awaySide!) || 'Unbekannt',
          competitionName: m.competition ? (competitionCache.get(m.competition) || '') : '',
          gamedayScope: m.metadata.externalDataProvider,
          gamedayExternalId: m.metadata.externalDataProviderId,
          gamedayId: m.metadata.gamedayId,
        }));

      // Filtern und sortieren über die reine Funktion
      return filterAndSortMatches(resolved);
    },

    async getMatch(uuid: string): Promise<PlanningDeskMatch> {
      return apiFetch<PlanningDeskMatch>(`/sport/match/${encodeURIComponent(uuid)}`);
    },

    getClubName(uuid: string): string {
      return clubCache.get(uuid) || 'Unbekannt';
    },
  };
}
