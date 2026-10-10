import { LogGroupRef } from '../types';
import { RAW_FIELD_RUNS, knownRawFields, rawFieldsByGroup, recordRun } from './rawFieldHistory';

const api: LogGroupRef = { name: '/app/api', region: 'us-east-2' };
const worker: LogGroupRef = { name: '/app/worker', region: 'us-east-2' };

describe('rawFieldsByGroup', () => {
  it('attributes fields to the group in @log', () => {
    const seen = rawFieldsByGroup(
      [api, worker],
      [
        { logGroup: '123:/app/api', message: '{"user":{"id":1},"path":"/"}' },
        { logGroup: '123:/app/worker', message: '{"job":"x"}' },
      ]
    );

    expect(Array.from(seen.get('us-east-2:/app/api')!)).toEqual(['user.id', 'path']);
    expect(Array.from(seen.get('us-east-2:/app/worker')!)).toEqual(['job']);
  });

  it('lists a group whose messages are not JSON, and skips rows without a message', () => {
    const seen = rawFieldsByGroup(
      [api, worker],
      [{ logGroup: '/app/api', message: 'plain' }, { logGroup: '/app/worker' }]
    );

    expect(seen.get('us-east-2:/app/api')?.size).toBe(0);
    expect(seen.has('us-east-2:/app/worker')).toBe(false);
  });

  it('uses the only group when @log is missing', () => {
    const seen = rawFieldsByGroup([api], [{ message: '{"a":1}' }]);

    expect(Array.from(seen.get('us-east-2:/app/api')!)).toEqual(['a']);
  });
});

describe('recordRun', () => {
  it(`forgets fields not seen in the last ${RAW_FIELD_RUNS} queries of the group`, () => {
    let history = recordRun({}, new Map([['g', new Set(['old', 'kept'])]]));
    for (let i = 1; i < RAW_FIELD_RUNS; i++) {
      history = recordRun(history, new Map([['g', new Set(['kept'])]]));
    }
    expect(Object.keys(history.g.fields).sort()).toEqual(['kept', 'old']);

    history = recordRun(history, new Map([['g', new Set(['kept'])]]));
    expect(Object.keys(history.g.fields)).toEqual(['kept']);
  });

  it('counts queries per group', () => {
    let history = recordRun({}, new Map([['a', new Set(['x'])]]));
    for (let i = 0; i < RAW_FIELD_RUNS * 2; i++) {
      history = recordRun(history, new Map([['b', new Set(['y'])]]));
    }

    expect(history.a).toEqual({ runs: 1, fields: { x: 1 } });
  });
});

describe('knownRawFields', () => {
  it('merges the selected groups only', () => {
    let history = recordRun({}, new Map([['us-east-2:/app/api', new Set(['b', 'a'])]]));
    history = recordRun(history, new Map([['us-east-2:/app/worker', new Set(['c', 'a'])]]));

    expect(knownRawFields(history, [api])).toEqual(['a', 'b']);
    expect(knownRawFields(history, [api, worker])).toEqual(['a', 'b', 'c']);
  });
});
