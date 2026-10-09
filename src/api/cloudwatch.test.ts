import { FieldType, toDataFrame } from '@grafana/data';
import { framesToRows } from './cloudwatch';

describe('framesToRows', () => {
  const frame = toDataFrame({
    fields: [
      { name: '@timestamp', type: FieldType.time, values: [1760000000000, 1760000001000] },
      { name: '__log__grafana_internal__', type: FieldType.string, values: ['g', 'g'] },
      { name: 'message', type: FieldType.string, values: ['hello', 'world'] },
      { name: 'userId', type: FieldType.string, values: ['42', null] },
    ],
  });

  it('drops internal fields and the implicit @timestamp', () => {
    const { fields, rows } = framesToRows([frame], 'fields message, userId');
    expect(fields).toEqual(['message', 'userId']);
    expect(rows).toEqual([{ message: 'hello', userId: '42' }, { message: 'world' }]);
  });

  it('keeps @timestamp when the query asks for it', () => {
    const { fields, rows, timeFields } = framesToRows([frame], 'fields @timestamp, message');
    expect(fields[0]).toBe('@timestamp');
    expect(timeFields).toEqual(['@timestamp']);
    expect(rows[0]['@timestamp']).toBe('1760000000000');
  });
});
