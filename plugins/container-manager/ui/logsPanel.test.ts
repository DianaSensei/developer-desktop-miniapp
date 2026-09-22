import { describe, expect, it } from 'vitest';
import { buildMatcher, buildRows, detectLevel, formatTimestamp } from './LogsPanel';
import type { LogLine } from './types';

describe('buildMatcher', () => {
  it('truy vấn rỗng không lọc gì', () => {
    const m = buildMatcher('   ', false, false);
    expect(m.test).toBeNull();
    expect(m.ranges).toBeNull();
    expect(m.error).toBeNull();
  });

  it('tìm chuỗi thường, mặc định không phân biệt hoa thường', () => {
    const m = buildMatcher('ERROR', false, false);
    expect(m.test!('unhandled error at boot')).toBe(true);
    expect(m.ranges!('unhandled error at boot')).toEqual([[10, 15]]);
  });

  it('bật phân biệt hoa thường thì bỏ qua khác case', () => {
    const m = buildMatcher('ERROR', false, true);
    expect(m.test!('unhandled error')).toBe(false);
    expect(m.test!('unhandled ERROR')).toBe(true);
  });

  it('trả về mọi lần khớp trong một dòng', () => {
    const m = buildMatcher('ab', false, false);
    expect(m.ranges!('ab-ab-ab')).toEqual([[0, 2], [3, 5], [6, 8]]);
  });

  it('chế độ regex khớp theo mẫu', () => {
    const m = buildMatcher('GET /(users|orders)', true, false);
    expect(m.error).toBeNull();
    expect(m.test!('GET /users 200')).toBe(true);
    expect(m.test!('GET /health 200')).toBe(false);
  });

  it('regex có state không rò rỉ giữa các lần gọi', () => {
    // RegExp cờ /g nhớ lastIndex — nếu không reset, dòng thứ hai sẽ trượt.
    const m = buildMatcher('a', true, false);
    expect(m.test!('aaa')).toBe(true);
    expect(m.test!('aaa')).toBe(true);
    expect(m.ranges!('aaa')).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(m.ranges!('aaa')).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('regex khớp rỗng không treo vòng lặp', () => {
    const m = buildMatcher('x*', true, false);
    expect(m.ranges!('axxb')).toEqual([[1, 3]]);
  });

  it('regex sai cú pháp báo lỗi thay vì ném ra ngoài', () => {
    const m = buildMatcher('foo(', true, false);
    expect(m.error).toBeTruthy();
    expect(m.test).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('rút gọn RFC3339 về giờ:phút:giây.mili', () => {
    expect(formatTimestamp('2026-08-26T09:41:02.123456789Z')).toBe('09:41:02.123');
  });

  it('giữ nguyên khi không có phần thập phân', () => {
    expect(formatTimestamp('2026-08-26T09:41:02Z')).toBe('09:41:02');
  });

  it('trả nguyên chuỗi nếu không phải định dạng có T', () => {
    expect(formatTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
  });
});

describe('detectLevel', () => {
  it('đọc mức từ nội dung dòng, không phụ thuộc stream', () => {
    expect(detectLevel('2026-09-22T09:41:02Z ERROR failed to flush spans')).toBe('error');
    expect(detectLevel('level=warn msg="retrying"')).toBe('warn');
    expect(detectLevel('{"level":"debug","msg":"exporter queue size 0"}')).toBe('debug');
    expect(detectLevel('info\tservice/telemetry.go:86\tSetting up own telemetry')).toBeNull();
  });

  it('không nhầm chữ error nằm sâu trong payload', () => {
    // Một dòng INFO dài mang chữ "error" ở cuối body không phải là dòng lỗi.
    expect(detectLevel(`INFO ${'x'.repeat(200)} error`)).toBeNull();
  });

  it('không khớp khi từ khoá chỉ là một phần của từ khác', () => {
    expect(detectLevel('terrorism-watch started')).toBeNull();
    expect(detectLevel('debugger attached')).toBeNull();
  });
});

describe('buildRows', () => {
  const lines = Array.from({ length: 10 }, (_, i): LogLine => ({ stream: 'stdout', message: `line ${i}`, timestamp: null }));
  const hit = (s: string) => s === 'line 4';

  it('không có truy vấn thì giữ nguyên mọi dòng', () => {
    const { rows, matchIndexes } = buildRows(lines, null, '3');
    expect(rows).toHaveLength(10);
    expect(matchIndexes).toEqual([]);
    expect(rows.every((r) => r.kind === 'line')).toBe(true);
  });

  it('giữ n dòng hai bên mỗi kết quả và gộp phần bị bỏ thành một gap', () => {
    const { rows, matchIndexes } = buildRows(lines, hit, '3');
    expect(matchIndexes).toEqual([4]);
    // gap(0..0) + dòng 1..7 + gap(8..9)
    expect(rows.map((r) => (r.kind === 'gap' ? `gap:${r.hidden}` : r.index))).toEqual([
      'gap:1', 1, 2, 3, 4, 5, 6, 7, 'gap:2',
    ]);
  });

  it('"0" là chế độ chỉ hiện dòng khớp', () => {
    const { rows } = buildRows(lines, hit, '0');
    expect(rows.filter((r) => r.kind === 'line').map((r) => (r as { index: number }).index)).toEqual([4]);
  });

  it('"all" giữ toàn bộ log và chỉ đánh dấu dòng khớp', () => {
    const { rows } = buildRows(lines, hit, 'all');
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.kind === 'line' && r.match).map((r) => (r as { index: number }).index)).toEqual([4]);
  });

  it('các cửa sổ ngữ cảnh chồng nhau thì nhập lại, không sinh gap rỗng', () => {
    // ±3 quanh dòng 4 và dòng 6 phủ 1..9 liền mạch — chỉ còn một gap ở đầu,
    // không có gap 0 dòng chen giữa hai kết quả sát nhau.
    const { rows } = buildRows(lines, (s) => s === 'line 4' || s === 'line 6', '3');
    expect(rows.map((r) => (r.kind === 'gap' ? `gap:${r.hidden}` : r.index))).toEqual([
      'gap:1', 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(rows.some((r) => r.kind === 'gap' && r.hidden === 0)).toBe(false);
  });

  it('không khớp gì thì không trả về gap nào để trạng thái rỗng lên tiếng', () => {
    expect(buildRows(lines, () => false, '3')).toEqual({ rows: [], matchIndexes: [] });
  });

  it('index luôn là vị trí trong log đầy đủ, kể cả khi có gap phía trước', () => {
    // Đây là thứ việc cuộn tới đúng vị trí dựa vào: data-row phải trỏ về dòng
    // thật, không phải thứ tự trong danh sách đã lọc.
    const { rows } = buildRows(lines, (s) => s === 'line 9', '1');
    const last = rows[rows.length - 1];
    expect(last.kind === 'line' && last.index).toBe(9);
  });
});
