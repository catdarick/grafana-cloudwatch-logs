import { getCompletions } from './completion';

/** Completions with the cursor at the ‸ in the text. */
function at(text: string, fields: string[] = ['requestId', 'request-id', 'kubernetes.pod_name']) {
  const offset = text.indexOf('‸');
  const query = text.replace('‸', '');
  return getCompletions(query, offset, fields);
}

const labels = (text: string, kind?: string) =>
  at(text)
    ?.items.filter((i) => !kind || i.kind === kind)
    .map((i) => i.label);

describe('getCompletions', () => {
  it('offers commands where a command goes', () => {
    expect(at('‸')?.context).toBe('command');
    expect(at('fields a\n| ‸')?.context).toBe('command');
    expect(at('fields a\n| fil‸')).toMatchObject({ context: 'command', from: 11 });
    expect(labels('‸')?.slice(0, 4)).toEqual(['fields', 'filter', 'stats', 'sort']);
  });

  it('adds the space after | that the command needs', () => {
    const fields = at('fields a | ‸')?.items.find((i) => i.label === 'fields');
    expect(fields?.insertText).toBe('fields ');
    const right = at('fields a |‸')?.items.find((i) => i.label === 'estimate');
    expect(right?.insertText).toBe(' estimate');
  });

  it('offers fields and functions in an expression', () => {
    expect(at('fields ‸')?.context).toBe('expression');
    expect(at('stats count(‸')?.context).toBe('expression');
    expect(at('fields a,‸')?.context).toBe('expression');
    expect(at('filter x = ‸')?.context).toBe('expression');
    expect(labels('fields ‸', 'field')).toEqual(expect.arrayContaining(['requestId', '@timestamp']));
    expect(labels('fields ‸', 'function')).toContain('count');
    expect(labels('fields ‸', 'command')).toEqual([]);
  });

  it('completes the word being typed from its start, @ and dots included', () => {
    expect(at('fields @tim‸')?.from).toBe(7);
    expect(at('fields kubernetes.po‸')?.from).toBe(7);
    expect(at('stats count(req‸')?.from).toBe(12);
  });

  it('inserts field names the way the query must spell them', () => {
    const item = at('fields req‸')?.items.find((i) => i.label === 'request-id');
    expect(item).toMatchObject({ insertText: '`request-id`', filterText: 'request-id' });
    const quoted = at('fields `req‸')?.items.find((i) => i.label === 'request-id');
    expect(quoted).toMatchObject({ insertText: '`request-id`', filterText: '`request-id`' });
  });

  it('offers functions as calls with their parameters', () => {
    const item = at('fields ‸')?.items.find((i) => i.label === 'concat');
    expect(item).toMatchObject({ insertText: 'concat($0)', snippet: true, detail: 'concat(str, ...strings)' });
    expect(at('fields ‸')?.items.find((i) => i.label === 'now')?.insertText).toBe('now()');
  });

  it('offers keywords after a value', () => {
    expect(at('filter a = 1 ‸')?.context).toBe('operator');
    expect(labels('filter a = 1 an‸')).toContain('and');
    expect(labels('stats count(*) ‸')).toContain('by');
    expect(labels('fields a ‸')).not.toContain('by');
  });

  it('offers asc and desc after a sort key, but not inside it', () => {
    expect(at('sort @timestamp ‸')).toMatchObject({ context: 'sortDirection' });
    expect(labels('sort a desc, b d‸')).toEqual(['desc', 'asc']);
    expect(at('sort strlen(a ‸')?.context).toBe('operator');
  });

  it('offers any after limit', () => {
    expect(labels('fields a | limit ‸')).toEqual(['any']);
    expect(at('fields a | limit 5 ‸')).toBeUndefined();
  });

  it('offers commands too where a subquery may start', () => {
    expect(labels('filter id in (‸', 'command')).toContain('SOURCE');
  });

  it('offers nothing in strings, regexes, comments, after numbers and after as', () => {
    expect(at("filter a = 'x‸")).toBeUndefined();
    expect(at('filter a like /x‸')).toBeUndefined();
    expect(at('fields a # note‸')).toBeUndefined();
    expect(at('limit 5‸')).toBeUndefined();
    expect(at('fields a as ‸')).toBeUndefined();
  });
});
