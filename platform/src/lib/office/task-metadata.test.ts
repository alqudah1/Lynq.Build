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

  it("accepts the restaurant research stage", () => {
    expect(parseOfficeTaskMetadata(formatOfficeTaskDescription({ ...metadata, stage: "research" }))).toMatchObject({ stage: "research" });
    expect(parseOfficeTaskMetadata(formatOfficeTaskDescription({ ...metadata, stage: "outreach" }))).toMatchObject({ stage: "outreach" });
  });
});
