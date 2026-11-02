import type { ReactNode } from "react";

import type { ThreadDetails } from "../model/details.ts";
import { colors, statusColor } from "./theme.ts";

/** Files listed under Changes before the rest fold into a count. */
const MAX_FILES = 8;
/** Rows stay readable when the panel takes the conversation's place on a narrow terminal. */
const IN_PLACE_MAX_WIDTH = 64;

/** The web's thread details card as a right-hand column: workspace, branch and PR, changes, lineage, background work, goal. */
export function DetailsPanel(props: { readonly details: ThreadDetails | null; readonly width: number; readonly loading: boolean; readonly inPlace?: boolean }) {
  const { details } = props;
  // In place of the conversation it sits beside the thread list's border and needs none of its own.
  const width = props.inPlace ? Math.min(props.width, IN_PLACE_MAX_WIDTH) : props.width;
  const inner = Math.max(10, width - (props.inPlace ? 3 : 4));
  return (
    <box {...(props.inPlace ? {} : { border: ["left"] as const, borderColor: colors.border })} width={width} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} overflow="hidden">
      {!details ? <text fg={colors.faint}>No thread selected.</text> : <Sections details={details} inner={inner} loading={props.loading} />}
    </box>
  );
}

function Sections({ details, inner, loading }: { readonly details: ThreadDetails; readonly inner: number; readonly loading: boolean }) {
  const { workspace, branch, changes } = details;
  const files = changes?.files ?? [];
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
          <Line left={truncate(branch.name, inner - (branch.upstream?.length ?? 0) - 1)} right={branch.upstream ?? ""} />
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
        </Section>
      ) : null}

      {changes ? (
        <Section title="Changes" right={<Counts insertions={changes.insertions} deletions={changes.deletions} />}>
          {files.slice(0, MAX_FILES).map((file) => (
            <FileLine key={file.path} path={file.path} insertions={file.insertions} deletions={file.deletions} inner={inner} />
          ))}
          {files.length > MAX_FILES ? <text fg={colors.faint}>{`… ${files.length - MAX_FILES} more files`}</text> : null}
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
          {details.lineage.map((entry) => (
            <text key={entry.text} fg={colors.muted}>{truncate(`${entry.glyph} ${entry.text}`, inner)}</text>
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

function Line({ left, right }: { readonly left: string; readonly right: string }) {
  return (
    <box flexDirection="row">
      <text fg={colors.text}>{left}</text>
      <box flexGrow={1} />
      <text fg={colors.faint}>{right}</text>
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
