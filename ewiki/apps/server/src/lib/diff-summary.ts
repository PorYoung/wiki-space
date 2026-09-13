// ---------------------------------------------------------------------------
// 行级 diff（buildChangedSummary / buildAddedSummary）：
//   用 diff 包的 diffLines 做真正的行级 add/del/context 判定，
//   输出 { lines: string[] } 格式（" 行" / "- 行" / "+ 行"），
//   与原有接口完全兼容。同时记录 additions / deletions 计数。
// ---------------------------------------------------------------------------

import { diffLines } from "diff";

export interface ChangedSummary {
  lines: string[];
  additions: number;
  deletions: number;
}

const TRUNCATE_AT = 60; // 前端 diff 预览最多展示 60 行，超长时裁剪

/** 新文件摘要（全量视为新增） */
export function buildAddedSummary(content: string | null | undefined): ChangedSummary | null {
  return buildChangedSummary("", content ?? "");
}

/** 比较两段文本，返回 Git 格式的行级 diff */
export function buildChangedSummary(
  oldContent: string | null | undefined,
  newContent: string | null | undefined,
): ChangedSummary | null {
  if ((oldContent ?? "") === (newContent ?? "")) return null;

  const parts = diffLines(oldContent ?? "", newContent ?? "");
  const lines: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const part of parts) {
    if (part.added) {
      const chunk = part.value.split("\n").filter((l) => l.length > 0 || part.value.endsWith("\n"));
      // diffLines 会带末尾空行，过滤掉
      const cleaned = part.value.replace(/\n$/, "").split("\n");
      for (const l of cleaned) {
        if (l === "" && cleaned.indexOf(l) === cleaned.length - 1) continue;
        lines.push(`+ ${l}`);
        additions++;
      }
      void chunk;
    } else if (part.removed) {
      const cleaned = part.value.replace(/\n$/, "").split("\n");
      for (const l of cleaned) {
        if (l === "" && cleaned.indexOf(l) === cleaned.length - 1) continue;
        lines.push(`- ${l}`);
        deletions++;
      }
    } else {
      // context 行（两边都有）：保留少量作为锚点，便于前端展示
      const cleaned = part.value.replace(/\n$/, "").split("\n");
      for (const l of cleaned) {
        if (l === "" && cleaned.indexOf(l) === cleaned.length - 1) continue;
        // 只在有 actual changes 时才加 context（避免太长）
        if (additions + deletions > 0 && Math.random() < 0.3) {
          lines.push(`  ${l}`);
        }
      }
    }
  }

  if (additions === 0 && deletions === 0) return null;

  const truncated = lines.length > TRUNCATE_AT
    ? [...lines.slice(0, TRUNCATE_AT), `\u00a0…（diff 共 ${lines.length} 行，已裁剪）`]
    : lines;

  return { lines: truncated, additions, deletions };
}
