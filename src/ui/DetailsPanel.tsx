import type { ReactNode } from "react";

import { MAX_DETAIL_FILES, type DetailsAction, type ThreadDetails } from "../model/details.ts";
import { ClickRow } from "./Button.tsx";
import { colors, statusColor } from "./theme.ts";

/** Rows stay readable when the panel takes the conversation's place on a narrow terminal. */
const IN_PLACE_MAX_WIDTH = 64;

/**
 * The web's thread details card as a right-hand column: workspace, branch and PR, git actions,
 * changes, lineage, servers, automations, background work, goal. Lines that do something are
 * selectable with the keyboard and clickable.
 */
export function DetailsPanel(props: {
  readonly details: ThreadDetails | null;
  readonly width: number;
  readonly loading: boolean;
  readonly inPlace?: boolean;
  /** The selected line's action id, while the panel has focus. */
  readonly selected: string | null;
  readonly onActivate: (id: string) => void;
  /** Shown when there are no details, which defaults to no thread being selected. */
  readonly empty?: string;
}) {
  const { details } = props;
  // In place of the conversation it sits beside the thread list's border and needs none of its own.
  const width = props.inPlace ? Math.min(props.width, IN_PLACE_MAX_WIDTH) : props.width;
  const inner = Math.max(10, width - (props.inPlace ? 3 : 4));
  return (
    <box
      {...(props.inPlace ? {} : { border: ["left"] as const, borderColor: props.selected ? colors.borderFocused : colors.border })}
      width={width}
      flexShrink={0}
      flexDirection="column"
      overflow="hidden"
    >
      <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
        {!details ? <text fg={colors.faint}>{props.empty ?? "No thread selected."}</text> : <Sections details={details} inner={inner} loading={props.loading} selected={props.selected} onActivate={props.onActivate} />}
      </scrollbox>
    </box>
  );
}

interface LineProps {
  readonly selected: string | null;
  readonly onActivate: (id: string) => void;
}

function Sections({ details, inner, loading, selected, onActivate }: { readonly details: ThreadDetails; readonly inner: number; readonly loading: boolean } & LineProps) {
  const { workspace, branch, changes, git } = details;
  const files = changes?.files ?? [];
  const line = { selected, onActivate };
  return (
    <>
      <Section title="Workspace" first>
        <text fg={colors.text}>{startTruncate(workspace.path, inner)}</text>
        {workspace.worktree ? <text fg={colors.faint}>worktree</text> : null}
        <text fg={colors.muted}>{truncate(workspace.model, inner)}</text>
        {workspace.mode ? <text fg={colors.muted}>{truncate(workspace.mode, inner)}</text> : null}
      </Section>

      {branch ? (
        <Section title="Branch">
          <box flexDirection="row">
            <text fg={colors.text}>{truncate(branch.name, inner - (branch.upstream?.length ?? 0) - 1)}</text>
            <box flexGrow={1} />
            <text fg={colors.faint}>{branch.upstream ?? ""}</text>
          </box>
          {branch.pullRequest ? (
            <>
              <box flexDirection="row">
                <text fg={colors.text}>{`PR #${branch.pullRequest.number}  `}</text>
                <text fg={statusColor[branch.pullRequest.tone]}>{branch.pullRequest.state}</text>
                <box flexGrow={1} />
                {branch.pullRequest.checks ? <text fg={statusColor[branch.pullRequest.checks.tone]}>{branch.pullRequest.checks.text}</text> : null}
              </box>
              {branch.pullRequest.title ? <text fg={colors.muted}>{truncate(branch.pullRequest.title, inner)}</text> : null}
            </>
          ) : null}
          {git?.quick ? <Selectable id={`git:quick:${git.quick.action}`} {...line} color={colors.accent} text={`▸ ${git.quick.label}`} inner={inner} /> : null}
          {git?.menu.map((item) => <Selectable key={item.action} id={`git:${item.action}`} {...line} color={colors.muted} text={`  ${item.label}`} inner={inner} />)}
          {git && !git.quick && git.hint ? <text fg={colors.faint}>{truncate(git.hint, inner)}</text> : null}
        </Section>
      ) : null}

      {changes ? (
        <Section title="Changes" right={<Counts insertions={changes.insertions} deletions={changes.deletions} />}>
          {files.length > 0 ? <Selectable id="diff:*" {...line} color={colors.accent} text="▸ View diff" inner={inner} /> : null}
          {files.slice(0, MAX_DETAIL_FILES).map((file) => (
            <Selectable key={file.path} id={`diff:${file.path}`} {...line} inner={inner}>
              <FileLine path={file.path} insertions={file.insertions} deletions={file.deletions} inner={inner} />
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
        </Section>
      ) : loading ? (
        <Section title="Changes">
          <text fg={colors.faint}>Loading…</text>
        </Section>
      ) : null}
      {details.vcsNote ? <text fg={colors.faint} marginTop={1}>{details.vcsNote}</text> : null}

      {details.lineage.length > 0 ? (
        <Section title="Lineage">
          {details.lineage.map((entry) =>
            entry.threadId ? (
              <Selectable key={entry.threadId} id={`thread:${entry.threadId}`} {...line} color={colors.muted} text={`${entry.glyph} ${entry.text}`} inner={inner} />
            ) : (
              <text key={entry.text} fg={colors.muted}>{truncate(`${entry.glyph} ${entry.text}`, inner)}</text>
            ),
          )}
        </Section>
      ) : null}

      {details.servers.length > 0 ? (
        <Section title="Servers">
          {details.servers.map(({ server, label }) => (
            <Selectable key={server.port} id={`server:${server.port}`} {...line} color={colors.info} text={`● ${label}`} inner={inner} />
          ))}
        </Section>
      ) : null}

      {details.automations.length > 0 ? (
        <Section title="Automations">
          {details.automations.map((automation) => (
            <Selectable key={automation.task.id} id={`automation:${automation.task.id}`} {...line} inner={inner}>
              <box flexDirection="column">
                <text fg={colors.text}>{truncate(automation.task.title, inner)}</text>
                <box flexDirection="row">
                  <text fg={colors.faint}>{truncate(automation.schedule, inner - automation.status.length - 1)}</text>
                  <box flexGrow={1} />
                  <text fg={statusColor[automation.tone]}>{automation.status}</text>
                </box>
              </box>
            </Selectable>
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
          <text fg={colors.text}>{details.goal.objective}</text>
          <text fg={statusColor[details.goal.tone]}>{details.goal.status}</text>
        </Section>
      ) : null}
    </>
  );
}

/** A line that does something: highlighted when selected, activated by a click. */
function Selectable(props: LineProps & { readonly id: DetailsAction["id"]; readonly inner: number; readonly text?: string; readonly color?: string; readonly children?: ReactNode }) {
  const active = props.selected === props.id;
  return (
    <ClickRow selected={active} onPress={() => props.onActivate(props.id)}>
      {props.children ?? <text fg={active ? colors.text : (props.color ?? colors.muted)}>{truncate(props.text ?? "", props.inner)}</text>}
    </ClickRow>
  );
}

function Section(props: { readonly title: string; readonly right?: ReactNode; readonly first?: boolean; readonly children: ReactNode }) {
  return (
    <box flexDirection="column" marginTop={props.first ? 0 : 1} flexShrink={0}>
      <box flexDirection="row">
        <text fg={colors.muted}>
          <strong>{props.title}</strong>
        </text>
        <box flexGrow={1} />
        {props.right ?? null}
      </box>
      {props.children}
    </box>
  );
}

function FileLine(props: { readonly path: string; readonly insertions: number; readonly deletions: number; readonly inner: number }) {
  const counts = countsText(props.insertions, props.deletions);
  return (
    <box flexDirection="row">
      <text fg={colors.muted}>{startTruncate(props.path, Math.max(4, props.inner - counts.length - 1))}</text>
      <box flexGrow={1} />
      <Counts insertions={props.insertions} deletions={props.deletions} />
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

function truncate(text: string, width: number): string {
  const single = text.replace(/\s+/g, " ");
  return single.length > width ? `${single.slice(0, Math.max(0, width - 1))}…` : single;
}

/** Keeps the end of a path, where the file name is, as the web's StartTruncatedPath does. */
function startTruncate(text: string, width: number): string {
  return text.length > width ? `…${text.slice(text.length - width + 1)}` : text;
}
