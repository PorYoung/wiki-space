// ---------------------------------------------------------------------------
// P5 补单测：shared/tar —— UStar v0 tar header + buffer 格式正确性
// 验证字段布局（POSIX.1-2001 ustar）、magic、checksum、EOF 双块
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildTarBuffer, buildTarHeader, tarOctal } from './tar.js';

describe('tarOctal', () => {
  it('零转为零填充 + 终止 null', () => {
    const buf = tarOctal(0, 8);
    expect(buf).toHaveLength(8);
    expect(buf.toString('ascii')).toBe('0000000\0');
  });

  it('正数转为 8 进制零填充', () => {
    // 191_10 = 0o277_8
    const buf = tarOctal(191, 8);
    expect(buf.toString('ascii')).toBe('0000277\0');
  });

  it('负数被 clamp 到 0', () => {
    const buf = tarOctal(-5, 8);
    expect(buf.toString('ascii')).toBe('0000000\0');
  });
});

describe('buildTarHeader', () => {
  const H = buildTarHeader('hello.txt', 128, 1_700_000_000);

  it('header 恰好 512B', () => {
    expect(H).toHaveLength(512);
  });

  it('前 9B 是文件名（hello.txt），offset 9 及以后为 0（被 mode 覆盖前）', () => {
    // "hello.txt" = 9 字节 UTF-8
    expect(H.subarray(0, 9).toString('ascii')).toBe('hello.txt');
    // offset 9 = 0（还没到 mode 字段）
    expect(H[9]).toBe(0);
  });

  it('mode / uid / gid 默认值正确', () => {
    expect(H.subarray(100, 108).toString('ascii')).toBe('0000644\0');
    expect(H.subarray(108, 116).toString('ascii')).toBe('0000000\0');
    expect(H.subarray(116, 124).toString('ascii')).toBe('0000000\0');
  });

  it('size 位于 offset 124（12B octal）', () => {
    // 128 = 0o200_8；padStart(11) → "00000000200" + '\0'
    expect(H.subarray(124, 136).toString('ascii')).toBe('00000000200\0');
  });

  it('mtime 位于 offset 136', () => {
    // 1_700_000_000 = 0o14524770400_8
    expect(H.subarray(136, 148).toString('ascii')).toBe('14524770400\0');
  });

  it('typeflag = 0x30（普通文件 "0"）', () => {
    expect(H[156]).toBe(0x30);
  });

  it('magic = "ustar\\0"（offset 257）', () => {
    expect(H.subarray(257, 263).toString('ascii')).toBe('ustar\0');
  });

  it('version = "00"（offset 263）', () => {
    expect(H.subarray(263, 265).toString('ascii')).toBe('00');
  });

  it('checksum 可被 tar 工具识别（非全 0 / 非全空格）', () => {
    const chk = H.subarray(148, 156);
    // 计算 checksum（把 148-156 视作空格重算）
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : H[i];
    const chkStr = chk.toString('ascii').replace(/\0+$/, '');
    const chkVal = parseInt(chkStr, 8);
    expect(chkVal).toBe(sum);
  });

  it('长文件名（>100B）被截断到 100B（offset 0-99 全是 "a"）', () => {
    const longName = 'a'.repeat(200);
    const h = buildTarHeader(longName, 0, 0);
    // tarOctal 从 offset 0 到 99 是 name（全是 'a'）
    for (let i = 0; i < 100; i++) expect(h[i]).toBe(0x61);
    // offset 100 起被 mode 字段覆盖（'0000644\0'），故不测试 h[100]
  });
});

describe('buildTarBuffer', () => {
  it('空 entries 仍然生成双 EOF 零块（1024B）', () => {
    const buf = buildTarBuffer([]);
    expect(buf).toHaveLength(1024);
    for (let i = 0; i < 1024; i++) expect(buf[i]).toBe(0);
  });

  it('单文件：header(512) + data + padding + EOF(1024)', () => {
    const data = Buffer.from('hello'); // 5B
    const buf = buildTarBuffer([{ name: 'a.txt', data }], 1_700_000_000);
    const totalExpected = 512 + 5 + (512 - 5) + 1024;
    expect(buf).toHaveLength(totalExpected);

    expect(buf.subarray(0, 5).toString('ascii')).toBe('a.txt');
    const sizeStr = buf.subarray(124, 136).toString('ascii');
    expect(parseInt(sizeStr, 8)).toBe(5);
  });

  it('文件长度恰好 512 不补 padding', () => {
    const data = Buffer.alloc(512, 0x41);
    const buf = buildTarBuffer([{ name: 'b.bin', data }], 0);
    const expected = 512 + 512 + 1024; // header + 无 padding + EOF
    expect(buf).toHaveLength(expected);
  });

  it('多文件顺序拼接 + 各自独立 header', () => {
    const buf = buildTarBuffer(
      [
        { name: 'a.txt', data: Buffer.from('aa') },
        { name: 'b.txt', data: Buffer.from('bbbb') },
      ],
      0,
    );
    // 文件 a: header 512 + data 2 + pad 510 = 1024
    // 文件 b: header 512 + data 4 + pad 508 = 1024
    // EOF: 1024
    // 总计 = 3072
    expect(buf).toHaveLength(3072);

    // 第 0 个文件头
    expect(buf.subarray(0, 5).toString('ascii')).toBe('a.txt');
    // 数据段：offset 512
    expect(buf.subarray(512, 514).toString('ascii')).toBe('aa');
    // padding 从 offset 514 到 1024 全 0
    for (let i = 514; i < 1024; i++) expect(buf[i]).toBe(0);

    // 第 2 个文件头在 1024
    expect(buf.subarray(1024, 1024 + 5).toString('ascii')).toBe('b.txt');
    // 数据在 1024 + 512 = 1536
    expect(buf.subarray(1536, 1540).toString('ascii')).toBe('bbbb');

    // 最后 1024B 全 0（EOF，从 offset 2048 到 3072）
    const tail = buf.subarray(2048, 3072);
    for (let i = 0; i < 1024; i++) expect(tail[i]).toBe(0);
  });

  it('mtime 可以通过参数覆盖', () => {
    const buf = buildTarBuffer([{ name: 'x', data: Buffer.alloc(0) }], 12345);
    const h = buf.subarray(0, 512);
    const mtimeStr = h.subarray(136, 148).toString('ascii').replace(/\0+$/, '');
    expect(parseInt(mtimeStr, 8)).toBe(12345);
  });
});
