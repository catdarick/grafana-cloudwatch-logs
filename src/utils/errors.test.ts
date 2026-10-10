import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('reads capitalized Message from datasource resource errors', () => {
    const e = {
      status: 500,
      data: {
        Message:
          'GetLogGroups error: UnrecognizedClientException: The security token included in the request is invalid.',
        Error: 'UnrecognizedClientException: The security token included in the request is invalid.',
        StatusCode: 500,
      },
    };
    expect(errorMessage(e)).toBe(
      'GetLogGroups error: UnrecognizedClientException: The security token included in the request is invalid.'
    );
  });

  it('prefers per-query errors from /api/ds/query', () => {
    expect(errorMessage({ data: { message: 'Query error', results: { A: { error: 'bad syntax' } } } })).toBe(
      'bad syntax'
    );
  });

  it('reads lowercase message', () => {
    expect(errorMessage({ data: { message: 'Not found' } })).toBe('Not found');
  });

  it('falls back to Error, statusText and JSON, never [object Object]', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({ status: 502, statusText: 'Bad Gateway', data: {} })).toBe('Bad Gateway');
    expect(errorMessage({ data: { foo: 1 } })).toBe('{"foo":1}');
    expect(errorMessage('plain')).toBe('plain');
  });
});
