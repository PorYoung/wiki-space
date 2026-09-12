// ---------------------------------------------------------------------------
// 行级简化 diff（changedSummary）：
//   取两段文本共同前缀/后缀之间的行，分别视为删除/新增，各取前 4 行防超长。
//   落库形态 { lines: string[] }，行首 '+ ' / '- ' 由前端解析渲染为绿/红。
//   保存链路、Git 初始化、历史回填共用同一实现，保证口径一致。
// ---------------------------------------------------------------------------

export interface ChangedSummary {
  lines: string[];
}

export function buildChangedSummary(
  oldContent: string | null | undefined,
  newContent: string | null | undefined,
): ChangedSummary | null {
  if ((oldContent ?? '') === (newContent ?? '')) return null;
  const a = (oldContent ?? '').split('\n');
  const b = (newContent ?? '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);
  const lines = [
    ...removed.slice(0, 4).map((l) => `- ${l}`),
    ...(removed.length > 4 ? [`- …（另有 ${removed.length - 4} 行删除）`] : []),
    ...added.slice(0, 4).map((l) => `+ ${l}`),
    ...(added.length > 4 ? [`+ …（另有 ${added.length - 4} 行新增）`] : []),
  ];
  return { lines };
}

/** 新建文件（无旧内容）的摘要：全部视为新增，供初始化 / 历史回填使用 */
export function buildAddedSummary(content: string | null | undefined): ChangedSummary | null {
  return buildChangedSummary('', content ?? '');
}
