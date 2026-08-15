import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../theme.ts";
import { SplitBorder } from "../ui/border.ts";
import { DiffView } from "./Diff.tsx";
import { SPECIAL } from "./Input.tsx";
import type { FileDiff } from "../diff.ts";
import {
  changes as scanChanges,
  displayRoot,
  fileDiff,
  fullFile,
  isGitRepo,
  listDir,
  type Change,
  type TreeNode,
} from "../git.ts";

/** One selectable row in the left pane. */
type Row =
  | { kind: "header"; label: string; extra?: string }
  | { kind: "change"; change: Change }
  | { kind: "node"; node: TreeNode; depth: number };

/**
 * Files view: review surface for a workspace. Left: CHANGES (git vs HEAD)
 * then the FILES tree. Right: diff (or full file) on the shared DiffView.
 * NORMAL-mode letter keys; esc returns to the transcript.
 */
export function Files({
  root,
  workspace,
  refreshKey,
  onClose,
}: {
  root: string;
  workspace: string;
  /** bump to re-scan (agent finished an edit/write) */
  refreshKey: number;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dirCache, setDirCache] = useState<Record<string, TreeNode[]>>({});
  const [sel, setSel] = useState(0);
  const [pane, setPane] = useState<"tree" | "diff">("tree");
  const [open, setOpen] = useState<{ path: string; status?: Change["status"] } | null>(null);
  const [view, setView] = useState<"diff" | "full">("diff");
  const [filter, setFilter] = useState<string | null>(null); // null = not filtering
  const [flash, setFlash] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const git = useMemo(() => isGitRepo(root), [root]);

  const rescan = () => {
    setChanges(scanChanges(root));
    setDirCache({});
  };
  useEffect(rescan, [root]);
  useEffect(() => {
    if (refreshKey === 0) return;
    rescan();
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const dir = (rel: string): TreeNode[] => {
    if (dirCache[rel]) return dirCache[rel];
    const nodes = listDir(root, rel);
    // cache lazily; setState during render is avoided by deferring
    queueMicrotask(() => setDirCache((c) => (c[rel] ? c : { ...c, [rel]: nodes })));
    return nodes;
  };

  const changeStatus = (path: string) => changes.find((c) => c.path === path)?.status;

  // flatten the visible tree
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const total = changes.reduce((n, c) => ({ a: n.a + c.added, r: n.r + c.removed }), { a: 0, r: 0 });
    out.push({
      kind: "header",
      label: "CHANGES",
      extra: changes.length ? `${changes.length} · +${total.a} −${total.r}` : git ? "clean" : "no git",
    });
    for (const c of changes) out.push({ kind: "change", change: c });
    out.push({ kind: "header", label: "FILES" });
    const walk = (rel: string, depth: number) => {
      for (const node of dir(rel)) {
        if (filter !== null && filter !== "" && !node.dir && !node.path.toLowerCase().includes(filter.toLowerCase())) continue;
        out.push({ kind: "node", node, depth });
        if (node.dir && !node.ignored && (expanded.has(node.path) || (filter !== null && filter !== ""))) walk(node.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes, expanded, dirCache, filter, git]);

  const selectable = rows.map((r, i) => (r.kind === "header" ? -1 : i)).filter((i) => i >= 0);
  const cur = selectable.includes(sel) ? sel : (selectable[0] ?? 0);

  const openRow = (row: Row) => {
    if (row.kind === "change") {
      setOpen({ path: row.change.path, status: row.change.status });
      setView("diff");
    } else if (row.kind === "node") {
      if (row.node.dir) {
        if (row.node.ignored) return;
        setExpanded((e) => {
          const n = new Set(e);
          n.has(row.node.path) ? n.delete(row.node.path) : n.add(row.node.path);
          return n;
        });
      } else {
        const st = changeStatus(row.node.path);
        setOpen({ path: row.node.path, status: st });
        setView(st ? "diff" : "full");
      }
    }
  };

  const diff: FileDiff | null = useMemo(() => {
    if (!open?.status) return null;
    return fileDiff(root, open.path, open.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, changes, refreshKey]);
  const body: FileDiff | null = useMemo(() => {
    if (!open) return null;
    if (view === "diff" && diff) return diff;
    return { path: open.path, lines: fullFile(root, open.path, diff), added: diff?.added ?? 0, removed: diff?.removed ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, diff, refreshKey]);
  // hunk starts: rows where a change run begins (in full view, tinted runs)
  const hunks = useMemo(() => {
    if (!body) return [] as number[];
    const idx: number[] = [];
    body.lines.forEach((l, i) => {
      const changed = l.sign !== " ";
      const prevChanged = i > 0 && body.lines[i - 1]!.sign !== " ";
      if (changed && !prevChanged) idx.push(i);
    });
    return idx;
  }, [body]);
  const [hunk, setHunk] = useState(0);
  useEffect(() => setHunk(0), [open]);

  useKeyboard((key) => {
    if (key.ctrl || key.meta || key.option) return;
    // filter typing
    if (filter !== null) {
      if (key.name === "escape") return setFilter(null);
      if (key.name === "return") return setFilter(filter === "" ? null : filter);
      if (key.name === "backspace" || key.name === "delete") return setFilter((f) => (f ?? "").slice(0, -1));
      if (SPECIAL.has(key.name)) return;
      const t = key.sequence;
      if (t && !t.startsWith("\x1b") && t >= " ") setFilter((f) => (f ?? "") + t);
      return;
    }
    if (key.name === "escape") return onClose();
    if (key.name === "tab") return setPane((p) => (p === "tree" ? "diff" : "tree"));
    if (key.sequence === "/") return setFilter("");
    if (key.name === "r") return rescan();
    if (pane === "tree") {
      const pos = Math.max(0, selectable.indexOf(cur));
      if (key.name === "j" || key.name === "down") return setSel(selectable[Math.min(selectable.length - 1, pos + 1)] ?? cur);
      if (key.name === "k" || key.name === "up") return setSel(selectable[Math.max(0, pos - 1)] ?? cur);
      if (key.name === "l" || key.name === "return") {
        const row = rows[cur];
        if (row) openRow(row);
        if (row && row.kind !== "node") setPane("diff");
        if (row?.kind === "node" && !row.node.dir) setPane("diff");
        return;
      }
      if (key.name === "h") {
        const row = rows[cur];
        if (row?.kind === "node") {
          if (row.node.dir && expanded.has(row.node.path)) {
            setExpanded((e) => {
              const n = new Set(e);
              n.delete(row.node.path);
              return n;
            });
          } else {
            // jump to parent dir row
            const parent = row.node.path.split("/").slice(0, -1).join("/");
            const pi = rows.findIndex((r) => r.kind === "node" && r.node.path === parent);
            if (pi >= 0) setSel(pi);
          }
        }
        return;
      }
      return;
    }
    // diff pane
    const sb = scrollRef.current;
    const page = Math.max(1, (sb?.viewport.height ?? 20) - 2);
    if (key.name === "j" || key.name === "down") sb?.scrollBy(1);
    if (key.name === "k" || key.name === "up") sb?.scrollBy(-1);
    if (key.name === "d" && key.shift === false && view === "full") setView("diff");
    else if (key.name === "d") sb?.scrollBy(Math.ceil(page / 2));
    if (key.name === "u") sb?.scrollBy(-Math.ceil(page / 2));
    if (key.name === "f") setView("full");
    if (key.name === "h") setPane("tree");
    if (key.name === "n" || (key.name === "N" && key.shift)) {
      if (!hunks.length) return;
      const next = key.shift ? (hunk - 1 + hunks.length) % hunks.length : (hunk + 1) % hunks.length;
      setHunk(next);
      sb?.scrollTo(hunks[next]!);
    }
  });

  const statusColor = (s?: Change["status"]) =>
    s === "A" ? theme.diffAdded : s === "D" ? theme.diffRemoved : s === "M" ? theme.warning : theme.muted;

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      {/* header */}
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={theme.accent}><b>{workspace}</b></span>
          <span fg={theme.muted}> · files · {displayRoot(root)}</span>
          {flash ? <span fg={theme.success}>  ● updated</span> : ""}
        </text>
        <text fg={theme.muted}>
          {filter !== null ? (
            <span>
              <span fg={theme.accent}>/</span>
              <span fg={theme.fg}>{filter}</span>
              <span attributes={TextAttributes.INVERSE}> </span>
            </span>
          ) : (
            `${changes.length} changed`
          )}
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} marginTop={1}>
        {/* left: tree */}
        <box flexDirection="column" width={34} flexShrink={0} paddingLeft={1}>
          <scrollbox flexGrow={1} flexBasis={0} scrollbarOptions={{ visible: false }}>
            {rows.map((row, i) => {
              const active = i === cur && pane === "tree";
              if (row.kind === "header")
                return (
                  <box key={`h${row.label}`} marginTop={i === 0 ? 0 : 1} flexDirection="row" justifyContent="space-between" paddingRight={1}>
                    <text fg={theme.muted}><b>{row.label}</b></text>
                    {row.extra ? <text fg={theme.muted} attributes={TextAttributes.DIM}>{row.extra}</text> : null}
                  </box>
                );
              if (row.kind === "change")
                return (
                  <box key={`c${row.change.path}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={active ? theme.selection : undefined} paddingLeft={1}>
                    <text fg={active ? theme.bg : statusColor(row.change.status)}>{row.change.status} </text>
                    <text fg={active ? theme.bg : theme.fg}>{row.change.path}</text>
                  </box>
                );
              const n = row.node;
              const st = n.dir ? undefined : changeStatus(n.path);
              const glyph = n.dir ? (n.ignored ? "  " : expanded.has(n.path) ? "▾ " : "▸ ") : "  ";
              return (
                <box key={`n${n.path}`} flexDirection="row" height={1} overflow="hidden" backgroundColor={active ? theme.selection : undefined} paddingLeft={1 + row.depth * 2}>
                  <text fg={active ? theme.bg : n.ignored ? theme.placeholder : n.dir ? theme.fg : st ? theme.fg : theme.muted}>
                    {glyph}{n.name}{n.dir ? "/" : ""}
                  </text>
                  {st ? <text fg={active ? theme.bg : statusColor(st)}> {st}</text> : null}
                  {n.ignored ? <text fg={theme.placeholder} attributes={TextAttributes.DIM}> ignored</text> : null}
                </box>
              );
            })}
          </scrollbox>
        </box>

        {/* right: diff pane */}
        <box flexDirection="column" flexGrow={1} minHeight={0} {...SplitBorder} border={["left"]} borderColor={pane === "diff" ? theme.accent : theme.border}>
          {!open || !body ? (
            <box paddingLeft={2} paddingTop={1}>
              <text fg={theme.muted}>select a file — l/enter opens · tab switches panes · / filters</text>
            </box>
          ) : (
            <>
              <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
                <text>
                  <span fg={theme.fg}>{open.path}</span>
                  {open.status ? <span fg={statusColor(open.status)}>  {open.status}</span> : ""}
                  <span fg={theme.diffAdded}>  +{body.added}</span>
                  <span fg={theme.diffRemoved}> −{body.removed}</span>
                </text>
                <text fg={theme.muted}>
                  {view === "diff" ? "diff" : "full"} · {hunks.length ? `${hunk + 1}/${hunks.length} hunks` : "no changes"}
                </text>
              </box>
              <scrollbox ref={scrollRef} flexGrow={1} flexBasis={0} marginTop={1} paddingLeft={1} scrollbarOptions={{ visible: false }}>
                <DiffView diff={body} maxLines={5000} />
              </scrollbox>
            </>
          )}
        </box>
      </box>

      {/* footer hints */}
      <box flexDirection="row" gap={2} paddingLeft={1} marginTop={1}>
        <text fg={theme.muted}>files › {open?.path ?? "—"}</text>
        <box flexGrow={1} />
        <text fg={theme.fg}>j k <span fg={theme.muted}>move</span></text>
        <text fg={theme.fg}>l <span fg={theme.muted}>open</span></text>
        <text fg={theme.fg}>h <span fg={theme.muted}>up</span></text>
        <text fg={theme.fg}>tab <span fg={theme.muted}>pane</span></text>
        <text fg={theme.fg}>n N <span fg={theme.muted}>hunks</span></text>
        <text fg={theme.fg}>d f <span fg={theme.muted}>diff/full</span></text>
        <text fg={theme.fg}>/ <span fg={theme.muted}>filter</span></text>
        <text fg={theme.fg}>esc <span fg={theme.muted}>back</span></text>
      </box>
    </box>
  );
}
