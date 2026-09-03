import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JarvisPhoneControl } from "./JarvisPhoneControl";

const gatedCall = {
  session: {
    id: "session-1",
    status: "completed",
    verificationState: "verified",
    verificationAttempts: 1,
    callerNumberLastFour: "1234",
    callerNumberMatched: true,
    deliveryStatus: "ended",
    endedReason: "customer-ended-call",
    failureCode: null,
    startedAt: "2026-09-01T15:04:00.000Z",
    endedAt: "2026-09-01T15:07:00.000Z",
  },
  turns: [
    { id: "turn-1", role: "founder" as const, text: "Email the restaurant owner our proposal this week.", redactedKinds: [] },
    { id: "turn-2", role: "jarvis" as const, text: "Here's what I understood.", redactedKinds: [] },
  ],
  commands: [
    {
      id: "command-1",
      requestedOutcome: "Email the restaurant owner our proposal",
      target: "Pizzeria Bella",
      constraints: ["Send it this week"],
      requiredIntegrations: ["resend"],
      proposedSteps: ["Draft the message", "Send it after approval"],
      missingInformation: ["Which email address to use"],
      riskLevel: "high" as const,
      requiresApproval: true,
      gatedReasons: ["Contacting a customer or prospect"],
      riskReasons: ["Contacting a customer or prospect"],
      overrideAttempted: false,
      readback: "Here's what I understood.",
      confirmationStatus: "confirmed",
      dispatchState: "awaiting_approval",
      projectId: null,
      projectName: null,
      projectKey: null,
      failureCode: null,
      failureMessage: null,
      dispatchAttempts: 0,
      retryable: false,
      inFlight: false,
      decidedAt: null,
      decisionNote: null,
      createdAt: "2026-09-01T15:06:00.000Z",
    },
  ],
};

const startedCall = {
  ...gatedCall,
  session: { ...gatedCall.session, id: "session-2" },
  commands: [
    {
      ...gatedCall.commands[0],
      id: "command-2",
      requestedOutcome: "Research three Brampton restaurants",
      riskLevel: "low" as const,
      requiresApproval: false,
      gatedReasons: [],
      riskReasons: [],
      dispatchState: "directive_created",
      projectId: "project-1",
      projectName: "Brampton Restaurants",
      projectKey: "BRAMP01",
    },
  ],
};

function stubFetch(state: unknown, extra?: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/passcode")) {
      return new Response(JSON.stringify({ data: { available: true, passcode: "417296", expiresInMs: 300000 } }), { status: 200 });
    }
    if (extra && String(url).includes("/commands/")) {
      return new Response(JSON.stringify(extra), { status: 200 });
    }
    return new Response(JSON.stringify({ data: state }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const readyState = { readiness: { enabled: true, ready: true, completedChecks: 5, totalChecks: 5, missing: [] }, canDecide: true, canSeePasscode: true, refreshAfterMs: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JarvisPhoneControl accessibility", () => {
  it("shows what was said, understood, proposed, gated, and whether work started, with no axe violations", async () => {
    stubFetch({ ...readyState, calls: [gatedCall] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /what jarvis understood/i })).toBeInTheDocument());

    expect(screen.getByRole("heading", { name: /what was said/i })).toBeInTheDocument();
    expect(screen.getByText(/email the restaurant owner our proposal this week/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what needs your approval/i })).toBeInTheDocument();
    expect(screen.getByText("Contacting a customer or prospect")).toBeInTheDocument();
    expect(screen.getByText(/nothing has started/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been started for this yet/i)).toBeInTheDocument();
    expect(screen.getByText(/which email address to use/i)).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives the approve and decline controls real accessible names and calls the decision endpoint", async () => {
    const fetchMock = stubFetch({ ...readyState, calls: [gatedCall] }, { data: { message: "Approved. I opened the project." } });

    render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);
    const approve = await screen.findByRole("button", { name: /approve and start the work/i });
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeInTheDocument();

    fireEvent.click(approve);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organizations/organization-1/jarvis/phone/commands/command-1",
        expect.objectContaining({ method: "POST" })
      )
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/approved/i));
  });

  it("links to the live project once work has actually started", async () => {
    stubFetch({ ...readyState, calls: [startedCall] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    const link = await screen.findByRole("link", { name: /watch it live/i });
    expect(link).toHaveAttribute("href", "/app/lynq/jarvis/project-1");
    expect(screen.getByText(/the team is briefed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve and start the work/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reveals the verification passcode through a labelled control and announces it politely", async () => {
    stubFetch({ ...readyState, calls: [] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    const reveal = await screen.findByRole("button", { name: /show my code/i });
    fireEvent.click(reveal);

    await waitFor(() => expect(screen.getByText("417296")).toBeInTheDocument());
    // The live region is a node that is ALWAYS mounted, not the code element
    // itself. A polite region that comes into existence at the same moment as
    // its content is unreliable — the announcement races the node carrying it.
    expect(screen.getByText(/your code is showing/i)).toHaveAttribute("aria-live", "polite");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says plainly when phone control is off, and offers no controls that would imply otherwise", async () => {
    stubFetch({
      readiness: { enabled: false, ready: false, completedChecks: 1, totalChecks: 5, missing: ["Phone commands enabled", "Founder verification secret"] },
      canDecide: true,
      canSeePasscode: true,
      calls: [],
      refreshAfterMs: null,
    });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /phone control is turned off/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show my code/i })).not.toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Founder verification secret")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("announces a failed load in an alert and offers a working retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Phone control status is unavailable." } }), { status: 503 }))
    );

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Phone control status is unavailable."));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a refused call honestly and never renders a decision control for it", async () => {
    stubFetch({
      ...readyState,
      calls: [
        {
          ...gatedCall,
          session: { ...gatedCall.session, id: "session-3", status: "refused", verificationState: "unverified", callerNumberMatched: false, failureCode: "caller_number_mismatch" },
          turns: [],
          commands: [],
        },
      ],
    });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByText(/refused this call and took no instruction/i)).toBeInTheDocument());
    expect(screen.getByText(/did not come from your registered number/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve and start the work/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers a real retry on a failed dispatch and calls the endpoint with retry", async () => {
    const failedCall = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-4" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-3",
          requestedOutcome: "Research three Brampton restaurants",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "failed",
          failureCode: "model_rate_limited",
          failureMessage: "Provider returned 429",
          dispatchAttempts: 1,
          retryable: true,
        },
      ],
    };
    const fetchMock = stubFetch({ ...readyState, calls: [failedCall] }, { data: { message: "It worked this time. I opened the project." } });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    // The failure is stated plainly before any retry is offered.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not open the project/i));
    // Founder-facing language, not the log's vocabulary. "(model rate limited)"
    // is not something a non-technical reader can act on.
    expect(screen.getByRole("alert")).toHaveTextContent(/planner was busy/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/model rate limited/i);

    const retry = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retry);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organizations/organization-1/jarvis/phone/commands/command-3",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "retry" }) })
      )
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/worked this time/i));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says a command is out of retries instead of showing a button that would be refused", async () => {
    const exhaustedCall = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-5" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-4",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "failed",
          failureCode: "model_rate_limited",
          dispatchAttempts: 5,
          retryable: false,
        },
      ],
    };
    stubFetch({ ...readyState, calls: [exhaustedCall] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByText(/tried as many times as it can be/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a member the decision is not theirs to make, rather than a button that would be refused", async () => {
    // Any org member may READ this screen; only an owner/admin may decide.
    stubFetch({ ...readyState, canDecide: false, canSeePasscode: false, calls: [gatedCall] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /what needs your approval/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /approve and start the work/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^decline$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only an organization owner or admin can decide/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not offer a retry on a failure that already opened a project, and links to it instead", async () => {
    // Retrying would create a second project with a second copy of work that
    // may already be running, so the honest answer is a link, not a button.
    const partialCall = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-6" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-5",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "failed",
          failureCode: "provider_unreachable",
          projectId: "project-9",
          projectName: "Brampton Restaurants",
          dispatchAttempts: 1,
          retryable: false,
        },
      ],
    };
    stubFetch({ ...readyState, calls: [partialCall] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not finish the handoff/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/some of the work may already be running/i);
    // The claim "nothing was started" would be false here.
    expect(screen.queryByText(/nothing was started/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open it/i })).toHaveAttribute("href", "/app/lynq/jarvis/project-9");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says a dispatch is under way rather than leaving the founder guessing", async () => {
    const inFlight = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-7" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-6",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "dispatching",
          retryable: false,
          inFlight: true,
        },
      ],
    };
    stubFetch({ ...readyState, calls: [inFlight] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByText(/starting now/i)).toBeInTheDocument());
    // Neither "nothing started" nor "work started" is true while it is running.
    expect(screen.queryByText(/nothing has been started for this yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("stops promising a stalled dispatch is still working, and offers a real way out", async () => {
    // Past its lease: the process died without recording an outcome. Saying
    // "this page updates on its own" would be false — polling has stopped.
    const stalled = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-8" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-7",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "dispatching",
          inFlight: false,
          retryable: true,
          dispatchAttempts: 1,
        },
      ],
    };
    const fetchMock = stubFetch({ ...readyState, calls: [stalled] }, { data: { message: "It worked this time." } });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/stopped without finishing/i));
    expect(screen.queryByText(/starting now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/stopped part-way/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organizations/organization-1/jarvis/phone/commands/command-7",
        expect.objectContaining({ body: JSON.stringify({ decision: "retry" }) })
      )
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("JarvisPhoneControl — what it says about a dispatch that stopped part-way", () => {
  /**
   * Found by review round six. One branch covered every stalled dispatch, and
   * it asserted "Nothing was recorded as started" — including for the most
   * likely kill window of all: a process that dies AFTER the project row
   * exists (`projectId` is written the instant it does, precisely so this case
   * is recoverable) but before the agents are launched.
   *
   * The founder was told nothing had started about a live project with a
   * briefed team, then told the command had "been tried as many times as it
   * can be" when it had been tried once, and then told to call Jarvis again —
   * which would have produced a second copy of the running work. Three false
   * statements and one dangerous instruction, on the screen whose entire job
   * is to say honestly whether work started.
   */
  it("does not claim nothing started when a project already exists", async () => {
    const stalledWithProject = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-20" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-20",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "dispatching",
          inFlight: false,
          retryable: false,
          dispatchAttempts: 1,
          projectId: "project-20",
          projectName: "Brampton restaurant research",
        },
      ],
    };
    stubFetch({ ...readyState, calls: [stalledWithProject] });

    const { container } = render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/stopped before finishing the handoff/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/Brampton restaurant research/i);
    expect(screen.queryByText(/nothing was recorded as started/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tried as many times as it can be/i)).not.toBeInTheDocument();
    // Starting it again would create a second copy, so the way out is the
    // project itself, not a retry.
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open it/i })).toHaveAttribute("href", "/app/lynq/jarvis/project-20");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not tell a founder a command was tried five times when it was tried once", async () => {
    const stalledNotRetryable = {
      ...gatedCall,
      session: { ...gatedCall.session, id: "session-21" },
      commands: [
        {
          ...gatedCall.commands[0],
          id: "command-21",
          requiresApproval: false,
          gatedReasons: [],
          riskReasons: [],
          dispatchState: "dispatching",
          inFlight: false,
          retryable: false,
          dispatchAttempts: 1,
          projectId: null,
        },
      ],
    };
    stubFetch({ ...readyState, calls: [stalledNotRetryable] });

    render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/stopped without finishing/i));
    expect(screen.queryByText(/tried as many times as it can be/i)).not.toBeInTheDocument();
    expect(screen.getByText(/still settling this one/i)).toBeInTheDocument();
  });
});

describe("JarvisPhoneControl — the verification code panel", () => {
  /**
   * The panel used to gate only on readiness, so anyone who could read the
   * screen was shown "Show my code" — and the request was refused, with the
   * refusal swallowed into "Phone control may not be fully set up", telling
   * them the deployment was broken when the truth was that the code is not
   * theirs.
   */
  it("is not offered to someone whose request would be refused", async () => {
    stubFetch({ ...readyState, canSeePasscode: false, calls: [] });

    render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /phone control/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show my code/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/may not be fully set up/i)).not.toBeInTheDocument();
  });

  it("says what actually went wrong instead of blaming the deployment", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/passcode")) {
        return new Response(JSON.stringify({ error: { message: "This code belongs to the founder's account." } }), { status: 403 });
      }
      return new Response(JSON.stringify({ data: { ...readyState, calls: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JarvisPhoneControl organizationId="organization-1" organizationSlug="lynq" />);

    fireEvent.click(await screen.findByRole("button", { name: /show my code/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/belongs to the founder's account/i));
    expect(screen.queryByText(/may not be fully set up/i)).not.toBeInTheDocument();
  });
});
