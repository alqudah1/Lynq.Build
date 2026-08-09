import { describe, it, expect } from "vitest";
import { SOURCE_TYPES } from "./validation";
import { SOURCE_HIERARCHY, listSourceHierarchy, getSourceDefinition, compareSourceRanks, resolveSourceOrdering } from "./source-hierarchy";

describe("SOURCE_HIERARCHY — internal consistency", () => {
  it("has exactly nine entries, one per approved source type", () => {
    expect(SOURCE_HIERARCHY).toHaveLength(9);
  });

  it("covers every source type in the approved SOURCE_TYPES set exactly once — no gap, no duplicate", () => {
    const hierarchyTypes = SOURCE_HIERARCHY.map((e) => e.sourceType).sort();
    const approvedTypes = [...SOURCE_TYPES].sort();
    expect(hierarchyTypes).toEqual(approvedTypes);
  });

  it("assigns each of ranks 1 through 9 exactly once — no duplicate rankings, no gap", () => {
    const ranks = SOURCE_HIERARCHY.map((e) => e.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("ranks founder_decision as 1 (highest) and unverified as 9 (lowest), per LYNQ_BRAIN §7's exact order", () => {
    expect(getSourceDefinition("founder_decision").rank).toBe(1);
    expect(getSourceDefinition("unverified").rank).toBe(9);
  });
});

describe("listSourceHierarchy", () => {
  it("returns all nine entries in rank order", () => {
    const list = listSourceHierarchy();
    expect(list).toHaveLength(9);
    const ranks = list.map((e) => e.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("getSourceDefinition", () => {
  it("returns the correct label and rank for a known type", () => {
    const definition = getSourceDefinition("client_approved");
    expect(definition.rank).toBe(3);
    expect(definition.label).toBe("Client-approved information");
  });
});

describe("compareSourceRanks", () => {
  it("returns 'higher' when a outranks b", () => {
    expect(compareSourceRanks("founder_decision", "unverified")).toBe("higher");
  });

  it("returns 'lower' when a is outranked by b", () => {
    expect(compareSourceRanks("open_internet_search", "official_documentation")).toBe("lower");
  });

  it("returns 'equal' only when comparing a type to itself — no two distinct types ever tie", () => {
    expect(compareSourceRanks("meeting_notes", "meeting_notes")).toBe("equal");
    for (const entryA of SOURCE_HIERARCHY) {
      for (const entryB of SOURCE_HIERARCHY) {
        if (entryA.sourceType !== entryB.sourceType) {
          expect(compareSourceRanks(entryA.sourceType, entryB.sourceType)).not.toBe("equal");
        }
      }
    }
  });

  it("is antisymmetric — if a is higher than b, b is lower than a", () => {
    for (const entryA of SOURCE_HIERARCHY) {
      for (const entryB of SOURCE_HIERARCHY) {
        const forward = compareSourceRanks(entryA.sourceType, entryB.sourceType);
        const backward = compareSourceRanks(entryB.sourceType, entryA.sourceType);
        if (forward === "higher") expect(backward).toBe("lower");
        if (forward === "lower") expect(backward).toBe("higher");
        if (forward === "equal") expect(backward).toBe("equal");
      }
    }
  });
});

describe("resolveSourceOrdering", () => {
  it("resolves the higher-ranked source type as the winner, deterministically", () => {
    const result = resolveSourceOrdering("external_research", "founder_decision");
    expect(result.winner.sourceType).toBe("founder_decision");
    expect(result.comparison).toBe("lower");
  });

  it("gives the identical result regardless of argument order (the winner is a property of the pair, not the call shape)", () => {
    const forward = resolveSourceOrdering("meeting_notes", "ai_generated_draft");
    const backward = resolveSourceOrdering("ai_generated_draft", "meeting_notes");
    expect(forward.winner.sourceType).toBe(backward.winner.sourceType);
  });

  it("never fails to resolve a winner for any pair of distinct types — no impossible ordering, since rank is a strict total order", () => {
    for (const entryA of SOURCE_HIERARCHY) {
      for (const entryB of SOURCE_HIERARCHY) {
        const result = resolveSourceOrdering(entryA.sourceType, entryB.sourceType);
        expect(result.winner).toBeDefined();
        expect([entryA.sourceType, entryB.sourceType]).toContain(result.winner.sourceType);
      }
    }
  });
});
