import type { Extmark, TextareaRenderable } from "@opentui/core";
import type { ChatAttachment } from "@t3tools/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";

/** What a chip stands for: an attachment, which the sent text leaves out, or a mention, sent as `sent`. */
interface ChipData {
  readonly attachmentId?: string;
  readonly sent?: string;
}

/**
 * Makes `start`–`end` of the composer (in its cursor offsets) one chip: drawn in the accent
 * colour, stepped over by the cursor and deleted whole by backspace.
 */
export function markChip(composer: TextareaRenderable, start: number, end: number, data: ChipData): void {
  const extmarks = composer.extmarks;
  const typeId = extmarks.getTypeId("chip") ?? extmarks.registerType("chip");
  const styleId = composer.syntaxStyle?.getStyleId("extmark.chip");
  extmarks.create({ start, end, virtual: true, typeId, data, ...(styleId ? { styleId } : {}) });
}

/** Inserts `label` at the cursor as a chip, apart from the words either side. */
export function insertChip(composer: TextareaRenderable, label: string, data: ChipData): void {
  const before = composer.plainText[indexAtOffset(composer.plainText, composer.cursorOffset) - 1];
  if (before && !/\s/.test(before)) composer.insertText(" ");
  const start = composer.cursorOffset;
  composer.insertText(label);
  markChip(composer, start, composer.cursorOffset, data);
  composer.insertText(" ");
}

function chipsOf(composer: TextareaRenderable): Extmark[] {
  const typeId = composer.extmarks.getTypeId("chip");
  return typeId === null ? [] : composer.extmarks.getAllForTypeId(typeId);
}

const attachmentChips = (composer: TextareaRenderable) => chipsOf(composer).filter((chip) => (chip.data as ChipData | undefined)?.attachmentId);

/** The index in `text` of a cursor offset, which counts columns, and one for each line break. */
function indexAtOffset(text: string, offset: number): number {
  let column = 0;
  let index = 0;
  for (const char of text) {
    if (column >= offset) break;
    column += char === "\n" ? 1 : Bun.stringWidth(char);
    index += char.length;
  }
  return index;
}

/** The composer's text as it is sent and kept as a draft: mentions as they're sent, attachments (and the space after each) left out. */
export function composerText(composer: TextareaRenderable): string {
  const text = composer.plainText;
  let kept = "";
  let from = 0;
  for (const chip of chipsOf(composer).sort((a, b) => a.start - b.start)) {
    const data = (chip.data ?? {}) as ChipData;
    const start = indexAtOffset(text, chip.start);
    let end = indexAtOffset(text, chip.end);
    if (data.attachmentId && text[end] === " ") end++;
    kept += text.slice(from, start) + (data.sent ?? "");
    from = end;
  }
  return kept + text.slice(from);
}

/**
 * The composer's attachments as chips, `[image 1]` or `[report.pdf]`: each pending one gets a
 * chip at the cursor, removing an attachment takes its chip out, and deleting a chip removes
 * its attachment. Replace the text through `replaceText`, so the old chips going with the old
 * text doesn't count as deleting them.
 */
export function useComposerChips(deps: {
  readonly composerRef: RefObject<TextareaRenderable | null>;
  readonly composerKey: string;
  readonly pending: readonly ChatAttachment[];
  readonly remove: (attachment: ChatAttachment) => void;
}) {
  const { composerRef, composerKey, pending } = deps;
  /** The attachments with a chip in the composer as it is now. */
  const shown = useRef(new Set<string>());
  /** Bumped when the text is replaced, so the chips go back in. */
  const [replaced, setReplaced] = useState(0);

  // A new composer, new attachments or new text: each needs its chips.
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const chips = attachmentChips(composer);
    const present = new Set(chips.map((chip) => (chip.data as ChipData).attachmentId));
    for (const chip of chips) {
      if (pending.some((attachment) => attachment.id === (chip.data as ChipData).attachmentId)) continue;
      composer.extmarks.delete(chip.id);
      removeRange(composer, chip.start, chip.end);
    }
    let images = 0;
    for (const attachment of pending) {
      if (attachment.type === "image") images++;
      if (!present.has(attachment.id)) insertChip(composer, attachment.type === "image" ? `[image ${images}]` : `[${attachment.name}]`, { attachmentId: attachment.id });
    }
    shown.current = new Set(pending.map((attachment) => attachment.id));
  }, [composerKey, pending, replaced]);

  return {
    /** The text changed: an attachment whose chip was deleted goes too. */
    sync: () => {
      const composer = composerRef.current;
      if (!composer) return;
      const present = new Set(attachmentChips(composer).map((chip) => (chip.data as ChipData).attachmentId));
      for (const attachment of pending) {
        if (!shown.current.has(attachment.id) || present.has(attachment.id)) continue;
        shown.current.delete(attachment.id);
        deps.remove(attachment);
      }
    },
    /** Sets the composer's text, then puts the attachment chips back. */
    replaceText: (composer: TextareaRenderable, text: string) => {
      shown.current.clear();
      composer.setText(text);
      setReplaced((count) => count + 1);
    },
  };
}

/** Deletes the text between two cursor offsets, and the space after it, keeping the cursor where it was. */
function removeRange(composer: TextareaRenderable, start: number, end: number): void {
  const cursor = composer.cursorOffset;
  const stop = end + (composer.plainText[indexAtOffset(composer.plainText, end)] === " " ? 1 : 0);
  composer.cursorOffset = start;
  const from = composer.logicalCursor;
  composer.cursorOffset = stop;
  const to = composer.logicalCursor;
  composer.deleteRange(from.row, from.col, to.row, to.col);
  composer.cursorOffset = cursor >= stop ? cursor - (stop - start) : Math.min(cursor, start);
}
