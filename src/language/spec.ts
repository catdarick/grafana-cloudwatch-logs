/**
 * The Logs Insights query language as documented at
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html
 *
 * The one description of the language: highlighting, checking and autocomplete all read it, so a
 * command or function added here is known everywhere at once. AWS keeps adding commands; a word
 * missing from here is reported as unknown, not as an error.
 */

export interface CommandSpec {
  name: string;
  /** "required": meaningless without arguments, checked. "none": takes none, for autocomplete. */
  args: 'required' | 'optional' | 'none';
  /** Takes a plain comma-separated list of fields or expressions. */
  list?: boolean;
  description: string;
}

export interface FunctionSpec {
  name: string;
  /** Parameters as shown in autocomplete; empty for a function without any. */
  params: string;
  description: string;
}

export interface FieldSpec {
  name: string;
  description: string;
}

// Most used first: that is the order autocomplete offers them in.
export const COMMANDS: CommandSpec[] = [
  { name: 'fields', args: 'required', list: true, description: 'Selects fields and computes new ones' },
  { name: 'filter', args: 'required', description: 'Keeps the log events that match a condition' },
  { name: 'stats', args: 'required', description: 'Aggregates values, grouped with by' },
  { name: 'sort', args: 'required', description: 'Orders results by fields, asc or desc' },
  { name: 'limit', args: 'required', description: 'Returns at most N events; limit any N stops scanning early' },
  { name: 'parse', args: 'required', description: 'Extracts fields with a glob or regex pattern' },
  { name: 'display', args: 'required', list: true, description: 'Chooses the fields the results show' },
  { name: 'dedup', args: 'required', list: true, description: 'Drops events with the same values of the given fields' },
  { name: 'where', args: 'required', description: 'Same as filter' },
  { name: 'pattern', args: 'optional', description: 'Clusters log events into recurring patterns' },
  { name: 'diff', args: 'optional', description: 'Compares with the previous time period of the same length' },
  { name: 'anomaly', args: 'optional', description: 'Finds unusual patterns with machine learning' },
  { name: 'unmask', args: 'none', description: 'Shows content masked by a data protection policy' },
  { name: 'filterIndex', args: 'optional', description: 'Scans only log groups indexed on the field' },
  { name: 'SOURCE', args: 'optional', description: 'Selects log groups by prefix, account, class or tags' },
  { name: 'unnest', args: 'optional', description: 'Makes a record for each element of a list: unnest x into y' },
  { name: 'expand', args: 'optional', description: 'Makes an event for each element of a JSON array field' },
  { name: 'lookup', args: 'optional', description: 'Adds fields from a lookup table' },
  { name: 'join', args: 'optional', description: 'Joins events from another log group on a matching field' },
  { name: 'appendcols', args: 'optional', description: 'Appends the columns of a subquery by row position' },
  { name: 'addtotals', args: 'optional', description: 'Adds row and column totals of numeric fields' },
  { name: 'relevantfields', args: 'optional', description: 'Ranks fields by how much they relate to a condition' },
  { name: 'autoregress', args: 'optional', description: "Adds copies of a field's values from previous rows" },
  { name: 'logcompare', args: 'optional', description: 'Compares with a baseline window shifted back in time' },
  { name: 'filldown', args: 'optional', description: 'Fills gaps with the last value that is not null' },
  { name: 'fillmissing', args: 'optional', description: 'Adds rows for empty time bins after stats by bin()' },
  { name: 'cidrlookup', args: 'optional', description: 'Adds fields by matching an IP against CIDR ranges' },
  { name: 'outlier', args: 'optional', description: 'Finds or removes statistical outliers' },
  { name: 'accum', args: 'optional', description: 'Running total of a numeric field' },
  { name: 'sessionize', args: 'optional', description: 'Groups events into sessions by identity and inactivity' },
  { name: 'countFrequent', args: 'optional', description: 'Approximate counts of the most frequent values' },
  { name: 'estimate', args: 'none', description: 'Estimates the bytes the query would scan, without running it' },
];

export const FUNCTIONS: FunctionSpec[] = [
  // Aggregation, for stats.
  { name: 'count', params: '[field]', description: 'Number of events, or of events that have the field' },
  { name: 'avg', params: 'field', description: 'Average of the values' },
  { name: 'sum', params: 'field', description: 'Sum of the values' },
  { name: 'min', params: 'field', description: 'Smallest value' },
  { name: 'max', params: 'field', description: 'Largest value' },
  { name: 'pct', params: 'field, percent', description: 'Value at the given percentile: pct(@duration, 95)' },
  { name: 'countDistinct', params: 'field', description: 'Number of distinct values' },
  { name: 'count_distinct', params: 'field', description: 'Number of distinct values (older name)' },
  { name: 'stddev', params: 'field', description: 'Standard deviation of the values' },
  { name: 'variance', params: 'field', description: 'Population variance of the values' },
  { name: 'values', params: 'field', description: 'Distinct values of the field in each group' },
  { name: 'topk', params: 'k, field', description: 'The k most frequent values' },
  { name: 'earliest', params: 'field', description: 'Value from the event with the earliest timestamp' },
  { name: 'latest', params: 'field', description: 'Value from the event with the latest timestamp' },
  { name: 'sortsFirst', params: 'field', description: 'Value that sorts first' },
  { name: 'sortsLast', params: 'field', description: 'Value that sorts last' },
  // Time series, for stats.
  { name: 'rate', params: 'field, interval', description: 'Rate of change per interval' },
  { name: 'countOverTime', params: 'field', description: 'Events per time bin' },
  { name: 'sumOverTime', params: 'field', description: 'Sum of the values per time bin' },
  { name: 'histogram', params: 'field, buckets', description: 'Distribution of the values in equal-width buckets' },
  // Date and time.
  { name: 'bin', params: 'period', description: 'Rounds @timestamp down to the period, for grouping: bin(5m)' },
  { name: 'datefloor', params: 'timestamp, period', description: 'Rounds a timestamp down to the period' },
  { name: 'dateceil', params: 'timestamp, period', description: 'Rounds a timestamp up to the period' },
  { name: 'fromMillis', params: 'field', description: 'Timestamp from milliseconds since the epoch' },
  { name: 'toMillis', params: 'timestamp', description: 'Milliseconds since the epoch' },
  { name: 'now', params: '', description: 'Time the query started, in seconds since the epoch' },
  { name: 'parseDate', params: 'field, format[, timezone]', description: 'Epoch milliseconds from a date string' },
  { name: 'formatDate', params: 'timestamp, format[, timezone]', description: 'Formats a timestamp (strftime style)' },
  { name: 'strftime', params: 'timestamp, format[, timezone]', description: 'Same as formatDate' },
  { name: 'queryStartTime', params: '', description: 'Start of the query time range, epoch milliseconds' },
  { name: 'queryEndTime', params: '', description: 'End of the query time range, epoch milliseconds' },
  { name: 'queryTimeRange', params: '', description: 'Length of the query time range in milliseconds' },
  // General.
  { name: 'ispresent', params: 'field', description: 'True if the field exists' },
  { name: 'isempty', params: 'field', description: 'True if the field is missing or empty' },
  { name: 'isblank', params: 'field', description: 'True if the field is missing, empty or only white space' },
  { name: 'coalesce', params: 'field, ...fields', description: 'First value that is not null' },
  { name: 'if', params: 'condition, then, else', description: 'One value or the other, by the condition' },
  {
    name: 'case',
    params: 'condition, value, ...[, default]',
    description: 'Value of the first condition that is true',
  },
  { name: 'isNumeric', params: 'field', description: 'True if the value parses as a number' },
  { name: 'messageSize', params: 'field', description: 'Size of the value in bytes' },
  // JSON.
  { name: 'jsonParse', params: 'field', description: 'Map or list from a JSON string' },
  { name: 'jsonStringify', params: 'value', description: 'JSON string from a map or list' },
  { name: 'jsonArraySize', params: 'field', description: 'Number of elements of a JSON array' },
  { name: 'jsonArrayContains', params: 'field, value', description: 'True if a JSON array contains the value' },
  // Strings.
  { name: 'concat', params: 'str, ...strings', description: 'Joins strings' },
  { name: 'strlen', params: 'str', description: 'Length in characters' },
  { name: 'toupper', params: 'str', description: 'Upper case' },
  { name: 'tolower', params: 'str', description: 'Lower case' },
  { name: 'trim', params: 'str[, chars]', description: 'Removes white space (or the chars) at both ends' },
  { name: 'ltrim', params: 'str[, chars]', description: 'Removes white space (or the chars) at the start' },
  { name: 'rtrim', params: 'str[, chars]', description: 'Removes white space (or the chars) at the end' },
  { name: 'substr', params: 'str, start[, length]', description: 'Part of the string' },
  { name: 'replace', params: 'field, search, replacement', description: 'Replaces every occurrence of a string' },
  { name: 'regexReplace', params: 'field, pattern, replacement', description: 'Replaces every regex match' },
  { name: 'strcontains', params: 'str, search[, caseInsensitive]', description: '1 if the string contains search' },
  { name: 'startsWith', params: 'str, search', description: '1 if the string starts with search' },
  { name: 'endsWith', params: 'str, search', description: '1 if the string ends with search' },
  { name: 'split', params: 'str, delimiter', description: 'List of the parts between delimiters' },
  { name: 'urlencode', params: 'str', description: 'URL-encodes' },
  { name: 'urldecode', params: 'str', description: 'URL-decodes' },
  { name: 'base64encode', params: 'str', description: 'Base64-encodes' },
  { name: 'base64decode', params: 'str', description: 'Base64-decodes' },
  { name: 'hexToAscii', params: 'value', description: 'Text from a hexadecimal string' },
  { name: 'hexToDec', params: 'value', description: 'Number from a hexadecimal string' },
  { name: 'decToHex', params: 'value', description: 'Hexadecimal string from a number' },
  { name: 'md5', params: 'field', description: 'MD5 hash' },
  { name: 'sha256', params: 'field', description: 'SHA-256 hash' },
  // Numbers.
  { name: 'abs', params: 'a', description: 'Absolute value' },
  { name: 'ceil', params: 'a', description: 'Rounds up' },
  { name: 'floor', params: 'a', description: 'Rounds down' },
  { name: 'round', params: 'a[, decimals]', description: 'Rounds to the nearest integer or to decimals' },
  { name: 'greatest', params: 'a, ...numbers', description: 'Largest of the values' },
  { name: 'least', params: 'a, ...numbers', description: 'Smallest of the values' },
  { name: 'log', params: 'a', description: 'Natural logarithm' },
  { name: 'sqrt', params: 'a', description: 'Square root' },
  { name: 'haversine', params: 'lat1, lon1, lat2, lon2', description: 'Distance between two points in km' },
  { name: 'toNumber', params: 'field', description: 'Number from a string' },
  { name: 'toInt', params: 'field', description: '32-bit integer' },
  { name: 'toLong', params: 'field', description: '64-bit integer' },
  { name: 'toDouble', params: 'field', description: 'Floating point number' },
  // IP addresses.
  { name: 'isValidIp', params: 'field', description: 'True for an IPv4 or IPv6 address' },
  { name: 'isValidIpV4', params: 'field', description: 'True for an IPv4 address' },
  { name: 'isValidIpV6', params: 'field', description: 'True for an IPv6 address' },
  { name: 'isIpInSubnet', params: 'field, subnet', description: "True if the address is in the subnet's CIDR" },
  { name: 'isIpv4InSubnet', params: 'field, subnet', description: 'True if the IPv4 address is in the subnet' },
  { name: 'isIpv6InSubnet', params: 'field, subnet', description: 'True if the IPv6 address is in the subnet' },
  { name: 'ipv4ToNumber', params: 'field', description: 'Number of an IPv4 address' },
  { name: 'isPrivateIP', params: 'field', description: 'True for a private (RFC 1918) address' },
  { name: 'isPublicIP', params: 'field', description: 'True for a publicly routable address' },
  { name: 'isReservedIP', params: 'field', description: 'True for a reserved address' },
  // SOURCE.
  {
    name: 'logGroups',
    params: 'namePrefix: [...], accountIdentifier: [...], class: [...]',
    description: 'Log groups for SOURCE',
  },
  { name: 'dataSource', params: '[...]', description: 'Data sources for SOURCE' },
  { name: 'logGroupTags', params: '[{"key": ..., "values": [...]}]', description: 'Log groups by tag for SOURCE' },
];

/** Words that join or qualify expressions; never field names. */
export const KEYWORDS = [
  'and',
  'or',
  'not',
  'like',
  'in',
  'as',
  'by',
  'asc',
  'desc',
  // limit any N, stats ... offset 1h, unnest x into y, join/relevantfields ... where, lookup ... OUTPUT
  'any',
  'offset',
  'into',
  'where',
  'OUTPUT',
  'OUTPUTNEW',
];

export const SYSTEM_FIELDS: FieldSpec[] = [
  { name: '@timestamp', description: 'Time of the log event' },
  { name: '@message', description: 'The raw log event' },
  { name: '@logStream', description: 'Log stream of the event' },
  { name: '@log', description: 'Log group of the event, as account-id:name' },
  { name: '@ingestionTime', description: 'Time CloudWatch Logs received the event' },
  { name: '@ptr', description: 'Reference to the full log event' },
  { name: '@requestId', description: 'Lambda request ID' },
  { name: '@duration', description: 'Lambda duration' },
];

const commandsByName = new Map(COMMANDS.map((c) => [c.name.toLowerCase(), c]));
const functionsByName = new Map(FUNCTIONS.map((f) => [f.name.toLowerCase(), f]));
const keywords = new Set(KEYWORDS.map((k) => k.toLowerCase()));

// Commands, functions and keywords are not case-sensitive: STATS and stats are the same.
export const findCommand = (word: string) => commandsByName.get(word.toLowerCase());
export const findFunction = (word: string) => functionsByName.get(word.toLowerCase());
export const isKeyword = (word: string) => keywords.has(word.toLowerCase());

// asc and desc end a sort key and any comes before limit's number; every other keyword joins what
// comes before it to what follows, so it cannot end an expression.
const endingKeywords = new Set(['asc', 'desc', 'any']);
export const needsOperand = (word: string) => isKeyword(word) && !endingKeywords.has(word.toLowerCase());

// Letters, digits, underscores and dots, with @ only in front: anything else needs backticks.
const PLAIN_FIELD = /^@?[A-Za-z_][\w.]*$/;

/**
 * A field name as written in a query: backticks around a name with other characters, after the @
 * of a system field (@`aws.tag.a:b`), as the documentation requires.
 */
export function fieldRef(name: string): string {
  if (PLAIN_FIELD.test(name)) {
    return name;
  }
  const at = name.startsWith('@') ? '@' : '';
  return `${at}\`${name.slice(at.length).replace(/`/g, '``')}\``;
}

/** The name a field reference stands for: `my-field` → my-field. */
export function unquoteField(ref: string): string {
  return ref.replace(/`((?:[^`]|``)*)`/g, (_, inner: string) => inner.replace(/``/g, '`'));
}
