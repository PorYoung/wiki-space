// 兼容重导出：连接已提升至 @ewiki/db（本轮重构），既有相对导入保持有效
import { createDb } from '@ewiki/db';

export const { sql, db } = createDb();
