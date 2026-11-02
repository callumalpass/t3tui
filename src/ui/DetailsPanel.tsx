import type { ReactNode } from "react";

import { MAX_DETAIL_FILES, type ChangedFile, type DetailsAction, type DetailsFold, type LineageLine, type ThreadDetails } from "../model/details.ts";
import { ClickRow } from "./Button.tsx";
import { truncate } from "./text.ts";
import { colors, statusColor } from "./theme.ts";

/** Rows stay readable when the panel takes the conversation's place on a narrow terminal. */
const IN_PLACE_MAX_WIDTH = 64;
/** Cells in the context bar. */
const BAR_CELLS = 10;

/**
 * The web's thread details card as a right-hand column, what changes first: run state,
 * context and limits, the agent's tasks, changes, branch, subagents, servers, background
 * work, goal, automations, then where and how the thread runs. Lines that do something are
 * selectable with the keyboard and clickable.
 */
export function DetailsPanel(props: {
  readonly details: ThreadDetails | null;
  readonly width: number;
  readonly loading: boolean;
  readonly inPlace?: boolean;
  /** The selected line's action id, while the panel has focus. */
  readonly selected: string | null;
  readonly unfolded: ReadonlySet<DetailsFold>;
  readonly onActivate: (id: string) => void;
  /** Shown when there are no details, which defaults to no thread being selected. */
  readonly empty?: string;
}) {
  const { details } = props;
  const width = props.inPlace ? Math.min(props.width, IN_PLACE_MAX_WIDTH) : props.width;
  // A column of padding on each side, and one more for the scrollbox's scrollbar.
  const inner = Math.max(10, width - 3);
  return (
    <box
      width={width}
      // In place of the conversation the panel must take its column's height, or its
      // scrollbox grows with its content and spills over the composer below.
      flexGrow={props.inPlace ? 1 : 0}
      flexShrink={props.inPlace ? 1 : 0}
      minHeight={0}
      flexDirection="column"
      overflow="hidden"
      backgroundColor={colors.panel}
    >
      <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
        {!details ? (
          <text fg={colors.faint}>{props.empty ?? "No thread selected."}</text>
        ) : (
          <Sections details={details} inner={inner} loading={props.loading} unfolded={props.unfolded} selected={props.selected} onActivate={props.onActivate} />
        )}
      </scrollbox>
    </box>
  );
}

interface LineProps {
  readonly selected: string | null;
  readonly onActivate: (id: string) => void;
}

function Sections({ details, inner, loading, unfolded, selected, onActivate }: { readonly details: ThreadDetails; readonly inner: number; readonly loading: boolean; readonly unfolded: ReadonlySet<DetailsFold> } & LineProps) {
  const { branch, changes, git, tasks } = details;
  const files = changes?.files ?? [];
  const line = { selected, onActivate };
  const gitActions = git ? (
    <>
      {files.length > 0 || git.quick ? (
        <box flexDirection="row" marginLeft={-1}>
          {files.length > 0 ? <Action id="diff:*" {...line} text="▸ View diff" /> : null}
          {files.length > 0 && git.quick ? <text> </text> : null}
          {git.quick ? <Action id={`git:quick:${git.quick.action}`} {...line} text={`▸ ${git.quick.label}`} /> : null}
        </box>
      ) : null}
      {git.menu.map((item) => <Selectable key={item.action} id={`git:${item.action}`} {...line} color={colors.muted} text={`  ${item.label}`} inner={inner} />)}
    </>
  ) : files.length > 0 ? (
    <box flexDirection="row" marginLeft={-1}>
      <Action id="diff:*" {...line} text="▸ View diff" />
    </box>
  ) : null;
  const visibleTasks = tasks ? (tasks.window && !unfolded.has("tasks") ? tasks.steps.slice(tasks.window.start, tasks.window.end) : tasks.steps) : [];
  const finished = details.lineage.filter((entry) => entry.finished);
  const lineageTitle = details.subagents.total > 0 ? "Subagents" : "Lineage";
  return (
    <box flexDirection="column" rowGap={1} flexShrink={0}>
      <StatusBlock details={details} inner={inner} />

      {tasks ? (
        <Section title="Tasks" right={<text fg={colors.faint}>{`${tasks.done}/${tasks.total}`}</text>}>
          {visibleTasks.map((step) => (
            <box key={step.id} flexDirection="row">
              <text fg={step.status === "completed" ? colors.faint : step.status === "running" ? colors.info : colors.muted} flexShrink={0}>{`${TASK_GLYPHS[step.status]} `}</text>
              <text fg={step.status === "completed" ? colors.faint : step.status === "running" ? colors.text : colors.muted}>{truncate(step.text, inner - 2)}</text>
            </box>
          ))}
          {tasks.window ? <Selectable id="fold:tasks" {...line} color={colors.faint} text={unfolded.has("tasks") ? "‹ fewer" : `› ${tasks.total - (tasks.window.end - tasks.window.start)} more`} inner={inner} /> : null}
        </Section>
      ) : null}

      {changes ? (
        <Section title="Changes" right={<Counts insertions={changes.insertions} deletions={changes.deletions} />}>
          {files.slice(0, MAX_DETAIL_FILES).map((file) => (
            <Selectable key={file.path} id={`diff:${file.path}`} {...line} inner={inner}>
              <FileLine file={file} inner={inner} />
            </Selectable>
          ))}
          {files.length > MAX_DETAIL_FILES ? <text fg={colors.faint}>{`… ${files.length - MAX_DETAIL_FILES} more files (in the full diff)`}</text> : null}
          {files.length === 0 ? <text fg={colors.faint}>Working tree clean</text> : null}
          {changes.branchTotal ? (
            <box flexDirection="row">
              <text fg={colors.faint}>{truncate(`branch vs ${changes.branchTotal.baseRef ?? "base"} `, inner - 12)}</text>
              <box flexGrow={1} />
              <Counts insertions={changes.branchTotal.insertions} deletions={changes.branchTotal.deletions} />
            </box>
          ) : null}
          {gitActions}
        </Section>
      ) : loading ? (
        <Section title="Changes">
          <text fg={colors.faint}>Loading…</text>
        </Section>
      ) : null}
      {details.vcsNote ? <text fg={colors.faint}>{details.vcsNote}</text> : null}

      {branch ? (
        <box flexDirection="column" flexShrink={0}>
          <BranchLine branch={branch} inner={inner} />
          {branch.pullRequest?.title && branch.pullRequest.title.length <= inner ? <text fg={colors.faint}>{branch.pullRequest.title}</text> : null}
          {changes ? null : gitActions}
        </box>
      ) : null}

      {details.lineage.length > 0 ? (
        <Section
          title={lineageTitle}
          right={
            details.subagents.total > 0 ? (
              <box flexDirection="row">
                <text fg={colors.faint}>{`${details.subagents.total}`}</text>
                {details.subagents.running > 0 ? <text fg={colors.info}>{` · ${details.subagents.running} running`}</text> : null}
              </box>
            ) : undefined
          }
        >
          {details.lineage.filter((entry) => !entry.finished).map((entry) => <LineageRow key={entry.threadId ?? entry.text} entry={entry} inner={inner} {...line} />)}
          {finished.length > 0 ? <Selectable id="fold:subagents" {...line} color={colors.faint} text={`${unfolded.has("subagents") ? "⌄" : "›"} ${finished.length} finished`} inner={inner} /> : null}
          {unfolded.has("subagents") ? finished.map((entry) => <LineageRow key={entry.threadId ?? entry.text} entry={entry} inner={inner} {...line} />) : null}
        </Section>
      ) : null}

      {details.servers.length > 0 ? (
        <Section title="Servers">
          {details.servers.map(({ server, label }) => (
            <Selectable key={server.port} id={`server:${server.port}`} {...line} color={colors.info} text={`● ${label}`} inner={inner} />
          ))}
        </Section>
      ) : null}

      {details.background.length > 0 ? (
        <Section title="Background">
          {details.background.map((task, index) => (
            <text key={index} fg={colors.info}>{truncate(`${task.glyph} ${task.text}`, inner)}</text>
          ))}
        </Section>
      ) : null}

      {details.goal ? (
        <Section title="Goal">
          <text fg={colors.muted}>{details.goal.objective}</text>
          <text fg={statusColor(details.goal.tone)}>{details.goal.status}</text>
        </Section>
      ) : null}

      {details.automations.length > 0 ? (
        <Section title="Automations">
          {details.automations.map((automation) => (
            <Selectable key={automation.task.id} id={`automation:${automation.task.id}`} {...line} inner={inner}>
              <box flexDirection="row">
                <text fg={colors.muted}>{truncate(automation.task.title, inner - automation.when.length - 1)}</text>
                <box flexGrow={1} />
                <text fg={automation.tone === "muted" ? colors.faint : statusColor(automation.tone)}>{automation.when}</text>
              </box>
            </Selectable>
          ))}
        </Section>
      ) : null}

      <Footer workspace={details.workspace} inner={inner} />
    </box>
  );
}

const TASK_GLYPHS = { completed: "✓", running: "◐", pending: "○" } as const;

/** Run state, context window and limits: what the thread is doing and how much room it has. */
function StatusBlock({ details, inner }: { readonly details: ThreadDetails; readonly inner: number }) {
  const { status, context, limits } = details;
  if (!status && !context && !limits) return null;
  const shownLimits = limits ? fittingLimits(limits, inner - "Limits   ".length - " left".length) : null;
  const filled = context?.left == null ? 0 : Math.round((context.left / 100) * BAR_CELLS);
  return (
    <box flexDirection="column" flexShrink={0}>
      {status ? <text fg={statusColor(status.tone)}>{truncate(status.text, inner)}</text> : null}
      {context ? (
        <box flexDirection="row">
          <text fg={colors.muted}>{"Context  "}</text>
          {context.left === null ? (
            <text fg={colors.faint}>{`${context.used} used`}</text>
          ) : (
            <>
              <text fg={colors.muted}>{"█".repeat(filled)}</text>
              <text fg={colors.faint}>{"░".repeat(BAR_CELLS - filled)}</text>
              <text fg={context.left <= 10 ? colors.bad : context.left <= 25 ? colors.warn : colors.muted}>{`  ${context.left}% left`}</text>
            </>
          )}
        </box>
      ) : null}
      {shownLimits ? (
        <box flexDirection="row">
          <text fg={colors.muted} flexShrink={0}>{"Limits   "}</text>
          <box flexDirection="row" flexShrink={1}>
            {shownLimits.map((limit, index) => (
              <box key={limit.label} flexDirection="row">
                <text fg={colors.faint}>{`${index > 0 ? " · " : ""}${limit.label} `}</text>
                <text fg={limit.tone === "muted" ? colors.muted : statusColor(limit.tone)}>{`${limit.left}%`}</text>
              </box>
            ))}
            <text fg={colors.faint}> left</text>
          </box>
        </box>
      ) : null}
    </box>
  );
}

/** `main ↑2 · PR #1371 merged      ✓ checks` */
function BranchLine({ branch, inner }: { readonly branch: NonNullable<ThreadDetails["branch"]>; readonly inner: number }) {
  const pr = branch.pullRequest;
  const prText = pr ? ` · PR #${pr.number} ${pr.state}` : "";
  const checks = pr?.checks?.text ?? "";
  const upstream = branch.upstream ? ` ${branch.upstream}` : "";
  const name = truncate(branch.name, Math.max(6, inner - upstream.length - prText.length - (checks ? checks.length + 1 : 0)));
  return (
    <box flexDirection="row">
      <text fg={colors.muted}>{name}</text>
      {upstream ? <text fg={colors.faint}>{upstream}</text> : null}
      {pr ? (
        <>
          <text fg={colors.faint}>{` · PR #${pr.number} `}</text>
          <text fg={statusColor(pr.tone)}>{pr.state}</text>
        </>
      ) : null}
      <box flexGrow={1} />
      {pr?.checks ? <text fg={statusColor(pr.checks.tone)}>{pr.checks.text}</text> : null}
    </box>
  );
}

function LineageRow({ entry, inner, ...line }: { readonly entry: LineageLine; readonly inner: number } & LineProps) {
  const content = (
    <box flexDirection="row">
      <text fg={statusColor(entry.tone)} flexShrink={0}>{`${entry.glyph} `}</text>
      <text fg={line.selected === `thread:${entry.threadId}` ? colors.text : colors.muted}>{truncate(entry.text, inner - 2)}</text>
    </box>
  );
  return entry.threadId ? (
    <Selectable id={`thread:${entry.threadId}`} {...line} inner={inner}>
      {content}
    </Selectable>
  ) : (
    content
  );
}

/** Where and how the thread runs, quiet at the bottom: one line, or two when it doesn't fit. */
function Footer({ workspace, inner }: { readonly workspace: ThreadDetails["workspace"]; readonly inner: number }) {
  const where = `${workspace.path}${workspace.worktree ? " · worktree" : ""}`;
  const how = [workspace.model, workspace.mode].filter(Boolean).join(" · ");
  const one = `${where} · ${how}`;
  return one.length <= inner ? (
    <text fg={colors.faint}>{one}</text>
  ) : (
    <box flexDirection="column" flexShrink={0}>
      <text fg={colors.faint}>{startTruncate(where, inner)}</text>
      <text fg={colors.faint}>{truncate(how, inner)}</text>
    </box>
  );
}

/**
 * A line that does something: highlighted when selected, activated by a click. The negative
 * margins pull the row over the panel's padding, so the selection bar sits at the panel's
 * edge and its background runs the full width, as in the thread list.
 */
function Selectable(props: LineProps & { readonly id: DetailsAction["id"]; readonly inner: number; readonly text?: string; readonly color?: string; readonly children?: ReactNode }) {
  const active = props.selected === props.id;
  return (
    <ClickRow flexDirection="row" marginLeft={-1} marginRight={-1} paddingRight={1} selected={active} onPress={() => props.onActivate(props.id)}>
      <text fg={colors.accent} flexShrink={0} selectable={false}>{active ? "▌" : " "}</text>
      {props.children ? <box flexGrow={1} flexDirection="column">{props.children}</box> : <text fg={active ? colors.text : (props.color ?? colors.muted)}>{truncate(props.text ?? "", props.inner)}</text>}
    </ClickRow>
  );
}

/** A selectable label that shares its line with another, as `▸ View diff  ▸ Commit`. */
function Action(props: LineProps & { readonly id: DetailsAction["id"]; readonly text: string }) {
  const active = props.selected === props.id;
  return (
    <ClickRow flexDirection="row" flexShrink={0} paddingRight={1} selected={active} onPress={() => props.onActivate(props.id)}>
      <text fg={colors.accent} selectable={false}>{active ? "▌" : " "}</text>
      <text fg={active ? colors.text : colors.accent}>{props.text}</text>
    </ClickRow>
  );
}

function Section(props: { readonly title: string; readonly right?: ReactNode; readonly children: ReactNode }) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row">
        <text fg={colors.text}>
          <strong>{props.title}</strong>
        </text>
        <box flexGrow={1} />
        {props.right ?? null}
      </box>
      {props.children}
    </box>
  );
}

/** `M src/a.ts   +3 −1`, git status style; `? docs/   new` for untracked paths, which have no counts. */
function FileLine({ file, inner }: { readonly file: ChangedFile; readonly inner: number }) {
  const right = file.status === "?" ? "new" : countsText(file.insertions, file.deletions);
  return (
    <box flexDirection="row">
      <text fg={colors.muted} flexShrink={0}>{`${file.status} `}</text>
      <text fg={colors.muted}>{startTruncate(file.path, Math.max(4, inner - right.length - 3))}</text>
      <box flexGrow={1} />
      {file.status === "?" ? <text fg={colors.faint}>new</text> : <Counts insertions={file.insertions} deletions={file.deletions} />}
    </box>
  );
}

function Counts({ insertions, deletions }: { readonly insertions: number; readonly deletions: number }) {
  return (
    <box flexDirection="row">
      {insertions > 0 ? <text fg={colors.good}>{`+${insertions}`}</text> : null}
      {insertions > 0 && deletions > 0 ? <text> </text> : null}
      {deletions > 0 ? <text fg={colors.bad}>{`−${deletions}`}</text> : null}
    </box>
  );
}

function countsText(insertions: number, deletions: number): string {
  return [insertions > 0 ? `+${insertions}` : "", deletions > 0 ? `−${deletions}` : ""].filter(Boolean).join(" ");
}

/** Keeps the end of a path, where the file name is, as the web's StartTruncatedPath does. */
function startTruncate(text: string, width: number): string {
  return text.length > width ? `…${text.slice(text.length - width + 1)}` : text;
}

/** The tightest limits first, as many as fit on the line, and always the tightest. */
function fittingLimits<T extends { readonly label: string; readonly left: number }>(limits: readonly T[], width: number): T[] {
  const shown: T[] = [];
  let used = 0;
  for (const limit of [...limits].sort((a, b) => a.left - b.left)) {
    const cost = (shown.length > 0 ? 3 : 0) + `${limit.label} ${limit.left}%`.length;
    if (shown.length > 0 && used + cost > width) break;
    shown.push(limit);
    used += cost;
  }
  return shown;
}
