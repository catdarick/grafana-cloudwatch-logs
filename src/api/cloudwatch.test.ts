import { FieldType, toDataFrame } from '@grafana/data';
import { framesToRows, returnsMessage, withMessageField } from './cloudwatch';

describe('framesToRows', () => {
  const frame = toDataFrame({
    fields: [
      { name: '@timestamp', type: FieldType.time, values: [1760000000000, 1760000001000] },
      { name: '__log__grafana_internal__', type: FieldType.string, values: ['g', 'g'] },
      { name: '__message__grafana_internal__', type: FieldType.string, values: ['{"a":1}', null] },
      { name: 'message', type: FieldType.string, values: ['hello', 'world'] },
      { name: 'userId', type: FieldType.string, values: ['42', null] },
    ],
  });

  it('drops internal fields and the implicit @timestamp', () => {
    const { fields, rows } = framesToRows([frame], 'fields message, userId');
    expect(fields).toEqual(['message', 'userId']);
    expect(rows).toEqual([{ message: 'hello', userId: '42' }, { message: 'world' }]);
  });

  it('keeps the raw message and log group per row', () => {
    const { details } = framesToRows([frame], 'fields message');
    expect(details).toEqual([
      { message: '{"a":1}', logGroup: 'g', logStream: undefined, timestamp: 1760000000000 },
      { message: undefined, logGroup: 'g', logStream: undefined, timestamp: 1760000001000 },
    ]);
  });

  it('sums query statistics across frames', () => {
    const withStats = (bytes: number) =>
      toDataFrame({
        fields: [{ name: 'message', type: FieldType.string, values: ['x'] }],
        meta: {
          stats: [
            { displayName: 'Bytes scanned', value: bytes },
            { displayName: 'Records matched', value: 1 },
          ],
        },
      });
    expect(framesToRows([withStats(100), withStats(50)], 'fields message').stats).toEqual({
      bytesScanned: 150,
      recordsMatched: 2,
    });
  });

  it('prepends the message field to the query', () => {
    expect(withMessageField('fields a | limit 5')).toBe(
      'fields @message as __message__grafana_internal__\n| fields a | limit 5'
    );
  });

  it('leaves a query that returns @message itself as it is', () => {
    const query = 'fields @timestamp, @message | sort @timestamp desc';
    expect(withMessageField(query)).toBe(query);
  });

  it("takes the raw message from the query's own @message when there is no copy", () => {
    const own = toDataFrame({
      fields: [
        { name: '@timestamp', type: FieldType.time, values: [1760000000000] },
        { name: '@message', type: FieldType.string, values: ['{"a":1}'] },
      ],
    });
    const { fields, details } = framesToRows([own], 'fields @timestamp, @message');
    expect(fields).toEqual(['@timestamp', '@message']);
    expect(details[0].message).toBe('{"a":1}');
  });

  it('keeps @timestamp when the query asks for it', () => {
    const { fields, rows, timeFields } = framesToRows([frame], 'fields @timestamp, message');
    expect(fields[0]).toBe('@timestamp');
    expect(timeFields).toEqual(['@timestamp']);
    expect(rows[0]['@timestamp']).toBe('1760000000000');
  });
});

describe('returnsMessage', () => {
  it.each([
    ['fields @timestamp, @message | sort @timestamp desc | limit 100', true],
    ['fields @message', true],
    ['filter level = "error" | fields @timestamp, `@message` | limit 5', true],
    ['fields @timestamp, @message | parse @message "* *" as a, b | dedup a', true],
    ['fields @timestamp | filter @message like /x/', false],
    ['fields @message as msg', false],
    ['fields strlen(@message)', false],
    ['fields @timestamp, @message | stats count() by bin(5m)', false],
    ['fields @timestamp, @message | display @timestamp', false],
    ['fields @message | pattern @message', false],
    ['fields @message | filter x in (SOURCE g | fields @message)', true],
    ['fields a | filter x in (SOURCE g | fields @message)', false],
  ])('%s → %s', (query, expected) => {
    expect(returnsMessage(query)).toBe(expected);
  });
});
