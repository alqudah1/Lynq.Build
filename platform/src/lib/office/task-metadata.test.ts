import { describe, expect, it } from "vitest";
import { formatOfficeTaskDescription, parseOfficeTaskMetadata } from "./task-metadata";

const metadata = {
  version: 1 as const,
  stage: "engineering" as const,
  agentId: "c56455a8-df9b-4db7-a425-106846301443",
  goal: "Implement the approved scope on an isolated feature branch.",
  successCriteria: "Tests pass and a pull request is ready for review.",
  handoff: "Send the pull request and preview to Quality Assurance.",
};

describe("Office task metadata", () => {
  it("round-trips the durable task payload", () => {
    expect(parseOfficeTaskMetadata(formatOfficeTaskDescription(metadata))).toEqual(metadata);
  });

  it("rejects ordinary descriptions and malformed embedded metadata", () => {
    expect(parseOfficeTaskMetadata("Write a report about the project.")).toBeNull();
    expect(parseOfficeTaskMetadata("<!-- LYNQ_OFFICE_TASK {not-json} -->")).toBeNull();
  });

  it("survives a goal that contains the envelope's own terminator", () => {
    /**
     * The terminator is found with `indexOf(" -->")` and `JSON.stringify` does
     * not escape `>`, so a goal containing that sequence ended the envelope
     * early and the metadata read as absent. Absent metadata is not a loud
     * failure: the sequential-handoff loop in `execution.ts` skips a task whose
     * metadata is missing, so a chain stopped part-way with nothing marked
     * failed and no event recorded. Reachable as soon as founder-dictated
     * speech started flowing into `goal`.
     */
    const withTerminator = { ...metadata, goal: "Ship the arrow syntax --> and keep the docs in step." };
    const description = formatOfficeTaskDescription(withTerminator);

    expect(parseOfficeTaskMetadata(description)).toEqual(withTerminator);
    // Exactly one terminator from the envelope's start onward: the real one.
    expect(description.slice(description.lastIndexOf("<!-- LYNQ_OFFICE_TASK ")).match(/ -->/g)).toHaveLength(1);
  });

  it("still reads an envelope written before the escaping was added", () => {
    // The escape parses back to the same string, so this changes what is
    // written and nothing about what can be read. Rows already in the database
    // must keep working.
    const legacy = `Goal\n\nHandoff: x\n\n<!-- LYNQ_OFFICE_TASK ${JSON.stringify(metadata)} -->`;
    expect(parseOfficeTaskMetadata(legacy)).toEqual(metadata);
  });

  it("accepts the restaurant research stage", () => {
    expect(parseOfficeTaskMetadata(formatOfficeTaskDescription({ ...metadata, stage: "research" }))).toMatchObject({ stage: "research" });
    expect(parseOfficeTaskMetadata(formatOfficeTaskDescription({ ...metadata, stage: "outreach" }))).toMatchObject({ stage: "outreach" });
  });
});
