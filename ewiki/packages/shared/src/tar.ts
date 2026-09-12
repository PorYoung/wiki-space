// ---------------------------------------------------------------------------
// 纯函数：手写 UStar v0 tar 格式构建（零依赖）
// 从 apps/worker/src/index.ts 提取，shared 包复用
// P5 补单测（见同目录 tar.test.ts）
// ---------------------------------------------------------------------------

/** 把整数转成 tar header 需要的零填充 8 进制 ASCII + 终止 null 字节 */
export function tarOctal(n: number, width: number): Buffer {
  const abs = Math.max(0, Math.floor(n));
  const s = abs.toString(8).padStart(width - 1, '0') + '\0';
  return Buffer.from(s, 'ascii');
}

/**
 * 手写 UStar v0 header（512 bytes）。
 * 字段布局严格遵循 POSIX.1-2001 pax ustar 格式。
 */
export function buildTarHeader(name: string, size: number, mtime: number): Buffer {
  const buf = Buffer.alloc(512);
  // name（100B，UTF-8，null 截断）
  const nameBytes = Buffer.from(name, 'utf8');
  nameBytes.copy(buf, 0, 0, Math.min(nameBytes.length, 100));
  // mode / uid / gid / size / mtime
  Buffer.from('0000644\0', 'ascii').copy(buf, 100);
  Buffer.from('0000000\0', 'ascii').copy(buf, 108);
  Buffer.from('0000000\0', 'ascii').copy(buf, 116);
  tarOctal(size, 12).copy(buf, 124);
  tarOctal(mtime, 12).copy(buf, 136);
  // checksum 临时填 8 个空格（0x20），计算后回填
  Buffer.from('        ', 'ascii').copy(buf, 148);
  // typeflag = '0'（普通文件）
  buf[156] = 0x30;
  // linkname / uname / gname / devmajor / devminor / prefix：默认零
  // magic = "ustar\0" + version = "00"
  Buffer.from('ustar\0', 'ascii').copy(buf, 257);
  Buffer.from('00', 'ascii').copy(buf, 263);
  // 校验和：header 所有字节之和（checksum 字段视作 8 个 0x20）
  let chk = 0;
  for (let i = 0; i < 512; i++) chk += buf[i];
  tarOctal(chk, 8).copy(buf, 148);
  return buf;
}

/** 把一组（name + data）拼成 tar buffer，末尾加双 EOF 零块 */
export function buildTarBuffer(entries: Array<{ name: string; data: Buffer }>, mtimeOverride?: number): Buffer {
  const chunks: Buffer[] = [];
  const mtime = mtimeOverride ?? Math.floor(Date.now() / 1000);
  for (const e of entries) {
    chunks.push(buildTarHeader(e.name, e.data.length, mtime));
    chunks.push(e.data);
    const rem = e.data.length % 512;
    if (rem > 0) chunks.push(Buffer.alloc(512 - rem));
  }
  chunks.push(Buffer.alloc(1024)); // 双 EOF 零块
  return Buffer.concat(chunks);
}
