import { defineConfig } from 'tsup';

export default defineConfig({
  // @ewiki/* workspace 包的 exports 指向 TS 源码（packages/*/src/index.ts），
  // 必须打进产物：否则 node dist 运行时会直接加载 .ts 报 ERR_UNKNOWN_FILE_EXTENSION
  //（tsx 开发模式无此问题，纯 node 生产模式必需）。
  noExternal: [/^@ewiki\//],
});
