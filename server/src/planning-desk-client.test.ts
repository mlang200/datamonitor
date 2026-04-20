import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveEntityNames, filterAndSortMatches, type ResolvedMatch } from './planning-desk-client.js';

/**
 * Property 7: Entity-Name-Resolution-Cache
 *
 * For every set of clubs (or competitions) with unique UUIDs and names,
 * after loading into the cache, each UUID resolves to the correct name.
 *
 * Tag: "Feature: kommentator-socket-app, Property 7: Entity-Name-Resolution-Cache"
 *
 * **Validates: Requirements 6.2, 6.3**
 */

const NUM_RUNS = 20;

// Generator for a unique entity (uuid + name)
const entityArb = fc.record({
  uuid: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
});

// Generator for a set of entities with unique UUIDs
const uniqueEntitiesArb = fc
  .array(entityArb, { minLength: 1, maxLength: 50 })
  .map((entities) => {
    const seen = new Set<string>();
    return entities.filter((e) => {
      if (seen.has(e.uuid)) return false;
      seen.add(e.uuid);
      return true;
    });
  })
  .filter((arr) => arr.length > 0);

describe('Feature: kommentator-socket-app, Property 7: Entity-Name-Resolution-Cache', () => {
  it('every UUID resolves to the correct name after loading', () => {
    fc.assert(
      fc.property(uniqueEntitiesArb, (entities) => {
        const cache = resolveEntityNames(entities);

        // Cache size matches number of unique entities
        expect(cache.size).toBe(entities.length);

        // Each UUID maps to the correct name
        for (const entity of entities) {
          expect(cache.get(entity.uuid)).toBe(entity.name);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('UUIDs not in the input set are not in the cache', () => {
    fc.assert(
      fc.property(uniqueEntitiesArb, fc.uuid(), (entities, extraUuid) => {
        // Only test when extraUuid is not already in the set
        fc.pre(!entities.some((e) => e.uuid === extraUuid));

        const cache = resolveEntityNames(entities);
        expect(cache.has(extraUuid)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Property 8: Match-Filterung und Sortierung
 *
 * For every set of planning desk matches with varying dates and metadata,
 * filterAndSortMatches(matches, today) returns only matches that:
 * (a) have gamedayScope != null AND gamedayExternalId != null
 * (b) have scheduledAt >= today (start of day UTC)
 * (c) are sorted ascending by scheduledAt
 *
 * Tag: "Feature: kommentator-socket-app, Property 8: Match-Filterung und Sortierung"
 *
 * **Validates: Requirements 6.4, 6.5**
 */

// Fixed reference date for deterministic tests
const FIXED_TODAY = new Date('2025-06-15T12:00:00Z');

// Generator for a date string relative to today — some in the past, some today or future
const dateStringArb = (today: Date) => {
  const todayMs = new Date(today).setUTCHours(0, 0, 0, 0);
  return fc.integer({ min: -30, max: 30 }).map((dayOffset) => {
    const d = new Date(todayMs + dayOffset * 24 * 60 * 60 * 1000);
    // Add random hours to make it more realistic
    d.setUTCHours(Math.floor(Math.random() * 24), 0, 0, 0);
    return d.toISOString();
  });
};

// Generator for nullable string (some null, some with value)
const nullableStringArb = fc.oneof(
  fc.constant(null as string | null),
  fc.string({ minLength: 1, maxLength: 20 }),
);

// Generator for a single ResolvedMatch
const resolvedMatchArb = (today: Date): fc.Arbitrary<ResolvedMatch> =>
  fc.record({
    uuid: fc.uuid(),
    sport: fc.constant('basketball'),
    scheduledAt: dateStringArb(today),
    homeTeam: fc.string({ minLength: 1, maxLength: 30 }),
    guestTeam: fc.string({ minLength: 1, maxLength: 30 }),
    competitionName: fc.string({ minLength: 0, maxLength: 30 }),
    gamedayScope: nullableStringArb,
    gamedayExternalId: nullableStringArb,
    gamedayId: nullableStringArb,
  });

// Generator for a set of matches
const matchesArb = (today: Date) =>
  fc.array(resolvedMatchArb(today), { minLength: 0, maxLength: 30 });

describe('Feature: kommentator-socket-app, Property 8: Match-Filterung und Sortierung', () => {
  it('result only contains matches with gamedayScope != null AND gamedayExternalId != null', () => {
    fc.assert(
      fc.property(matchesArb(FIXED_TODAY), (matches) => {
        const result = filterAndSortMatches(matches, FIXED_TODAY);

        for (const m of result) {
          expect(m.gamedayScope).not.toBeNull();
          expect(m.gamedayExternalId).not.toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result only contains matches with scheduledAt >= today (start of day UTC)', () => {
    fc.assert(
      fc.property(matchesArb(FIXED_TODAY), (matches) => {
        const result = filterAndSortMatches(matches, FIXED_TODAY);
        const todayStart = new Date(FIXED_TODAY);
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        for (const m of result) {
          expect(new Date(m.scheduledAt).getTime()).toBeGreaterThanOrEqual(todayMs);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('result is sorted ascending by scheduledAt', () => {
    fc.assert(
      fc.property(matchesArb(FIXED_TODAY), (matches) => {
        const result = filterAndSortMatches(matches, FIXED_TODAY);

        for (let i = 1; i < result.length; i++) {
          expect(new Date(result[i].scheduledAt).getTime())
            .toBeGreaterThanOrEqual(new Date(result[i - 1].scheduledAt).getTime());
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('no valid match is excluded from the result', () => {
    fc.assert(
      fc.property(matchesArb(FIXED_TODAY), (matches) => {
        const result = filterAndSortMatches(matches, FIXED_TODAY);
        const todayStart = new Date(FIXED_TODAY);
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        // Count how many input matches should pass the filter
        const expectedCount = matches.filter(
          (m) =>
            m.gamedayScope != null &&
            m.gamedayExternalId != null &&
            new Date(m.scheduledAt).getTime() >= todayMs,
        ).length;

        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
