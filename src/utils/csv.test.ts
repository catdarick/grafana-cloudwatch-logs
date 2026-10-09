import { toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header and quotes fields that need it', () => {
    expect(
      toCsv(
        ['time', 'message'],
        [
          { time: '2026-10-09 22:00:00', message: 'plain' },
          { time: '2026-10-09 22:00:01', message: 'has "quotes", commas\nand lines' },
          { message: 'no time' },
        ]
      )
    ).toBe(
      'time,message\r\n2026-10-09 22:00:00,plain\r\n2026-10-09 22:00:01,"has ""quotes"", commas\nand lines"\r\n,no time'
    );
  });
});
