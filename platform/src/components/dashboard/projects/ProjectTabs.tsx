"use client";

import { useState } from "react";

export interface ProjectTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Accessible tab pattern (WAI-ARIA APG): `role="tablist"`/`role="tab"`
 * with `aria-selected`/`aria-controls`, arrow-key navigation between
 * tabs, and a single `role="tabpanel"` rendering whichever tab's content
 * (already server-rendered JSX, passed in as a prop) is currently
 * selected. Content for every tab was already fetched/rendered
 * server-side — switching tabs is a pure client-side visibility toggle,
 * never a re-fetch.
 */
export function ProjectTabs({ tabs, initialTabId }: { tabs: ProjectTab[]; initialTabId?: string }) {
  const [activeId, setActiveId] = useState(initialTabId ?? tabs[0]?.id);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    setActiveId(tabs[nextIndex].id);
    document.getElementById(`project-tab-${tabs[nextIndex].id}`)?.focus();
  }

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`project-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={tab.id === activeId}
            aria-controls={`project-tabpanel-${tab.id}`}
            tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => setActiveId(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`lynq-transition min-h-11 px-4 text-xs font-medium uppercase tracking-[0.08em] border-b-2 ${tab.id === activeId ? "border-accent text-foreground" : "border-transparent text-subtle hover:text-foreground"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab ? (
        <div id={`project-tabpanel-${activeTab.id}`} role="tabpanel" aria-labelledby={`project-tab-${activeTab.id}`} tabIndex={0}>
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
