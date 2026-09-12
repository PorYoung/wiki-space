// ---------------------------------------------------------------------------
// P4-6 CRDT 协同：聚合导出 + 便捷 hook
//   useCollab()  —— 消费 <CollabProvider> 提供的上下文
//   CollabProvider —— 在 FileHost 或 BrowsePage 层按 docId 挂载一次
// ---------------------------------------------------------------------------

export { CollabProvider, useCollab } from './CollabProvider';
export type { CollabContextValue } from './CollabProvider';
export { CollabYDoc } from './YDoc';
export type { Peer, ConnectionState } from './YDoc';
