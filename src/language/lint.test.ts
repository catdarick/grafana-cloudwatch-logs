import { QueryProblem, lintQuery } from './lint';

const problems = (query: string, severity?: QueryProblem['severity']) =>
  lintQuery(query)
    .filter((p) => !severity || p.severity === severity)
    .map((p) => `${p.line}:${p.column} ${p.message}`);

describe('lintQuery', () => {
  // Examples from the Logs Insights documentation and common queries: none may raise anything.
  it.each([
    'fields @timestamp, @message\n| sort @timestamp desc\n| limit 100',
    'fields @timestamp, @message, accountId as ID\n| sort @timestamp desc\n| limit 20',
    'fields @timestamp, @message, accountId\n# | filter accountId not like "7983124201998"\n| sort @timestamp desc',
    'filter @message like /error|warn/i\n| stats count(*) as n by bin(5m)\n| sort n desc',
    'fields @timestamp, @message\n| filter @message like /(?i)(error|failure)/\n| filter toMillis(@timestamp) >= (now() * 1000 - 18000000)',
    'parse @message /(?<user>\\S+) did (?<what>.*)/ | display user, what',
    'parse @message "Status Code: *;" as statusCode\n| filter statusCode >= 400 and statusCode <= 499',
    'filter status >= 500 and ispresent(requestId) and level in ["error", "fatal"]',
    'fields a / 2 as half, (b + c) / d as ratio | sort half',
    'fields `my-field` | sort `my-field` asc, x',
    'filter @`aws.tag.aws:cloudformation:stack-name` = "my-stack"',
    'fields jsonParse(@message) as json_message\n| filter json_message.users[1].action = "PutData"',
    'fields jsonParse(@message) as json_message\n| filter json_message.`user.id` = "123"',
    "fields x # comment with | pipe and 'quote'\n# | filter commented out",
    'filter @message =~ /a\\/b/ | filter path like /[/]api/ | sort count(*) desc',
    'stats count(*) by duration as time\n| sort time desc',
    'stats sum(packets) as packetsTransferred by srcAddr, dstAddr\n    | sort packetsTransferred  desc\n    | limit 15',
    'FIELDS strlen(@message) AS message_length\n| STATS sum(message_length)/1024/1024 as logs_mb BY bin(5m)\n| STATS max(logs_mb) AS peak_ingest_mb,\n        min(logs_mb) AS min_ingest_mb',
    'STATS countDistinct(client_ip) AS session_ips, count(*) AS requests BY session_id\n| FILTER session_ips > 1',
    'stats count(*) by bin(5m) offset 1h',
    'stats topk(3, status)',
    'fields @message | limit any 1',
    'fields @message | limit 50000',
    'filter requestId in (\n    SOURCE \'/aws/lambda/db\'\n    | filter errorType = "Timeout"\n    | fields requestId\n)\n| fields @timestamp, requestId\n| sort @timestamp desc',
    "filter status >= 500\n| join type=inner left=api right=lambda\n    where api.requestId=lambda.requestId\n    (SOURCE '/aws/lambda/my-function')\n| fields api.requestId, lambda.duration",
    'fields svc\n| stats count(*) as cnt by svc\n| appendcols override=true ( SOURCE lg | stats avg(latency) as avgLat by svc )',
    'fields user_id, action\n| lookup user_data user_id OUTPUT username, email, department',
    'SOURCE logGroups(namePrefix: [\'/aws/lambda\']) logGroupTags([{"key":"environment", "values":["production"]}])\n| fields @message',
    'fields @timestamp, @message\n| filter @message like /error/\n| estimate',
    'where status = 500 | unmask | dedup requestId',
    "fields if(status >= 500, 'bad', 'ok') as health, concat(a, '-', b) as ab",
    'filter !ispresent(payment.eventType) or payment.status != "SUCCESS"',
    'fields @timestamp - 1000 as earlier, a - b as diff',
    'fields jsonParse(@message) as js\n| unnest js.accounts into account\n| filter account.type = "internal"',
    'relevantfields Controller, Path, Service where Time > 400',
    'expand items\n| stats count(*) by items, host',
    'fields srcAddr, hostname\n| lookup known_hosts ip_address as srcAddr OUTPUTNEW hostname, region',
    'FIELDS a\n| FILTER a > 1\n| SORT a DESC\n| LIMIT 5',
    'fields @timestamp\n# | sort x ascs\n| sort @timestamp desc',
    '',
  ])('passes %s', (query) => {
    expect(problems(query)).toEqual([]);
  });

  it('flags a word after a sort key as an error', () => {
    expect(problems('fields a\n| sort @timestamp desc, timestamp_internal ascs')).toEqual([
      '2:44 Expected asc or desc, found "ascs". Did you mean "asc"?',
    ]);
    expect(problems('sort a decs')).toEqual(['1:8 Expected asc or desc, found "decs". Did you mean "desc"?']);
    expect(problems('sort col_name sdf')).toEqual(['1:15 Expected asc, desc or a comma before "sdf"']);
  });

  it('flags a keyword, operator or comma with nothing after it as an error', () => {
    expect(problems('fields a\n| sort @timestamp desc, timestamp_internal as\n| limit 5')).toEqual([
      '2:44 Expected a name after "as"',
    ]);
    expect(problems('filter a = 1 and | stats count(*) by')).toEqual([
      '1:14 Expected a value after "and"',
      '1:35 Expected a value after "by"',
    ]);
    expect(problems('filter a =')).toEqual(['1:10 Expected a value after "="']);
    expect(problems('fields concat(a, ), b,')).toEqual([
      '1:16 Expected a value after ","',
      '1:22 Expected a value after ","',
    ]);
  });

  it('flags a missing comma in a field list as an error', () => {
    expect(problems('fields a b, c as d e')).toEqual([
      '1:10 Missing comma before "b"',
      '1:20 Missing comma before "e"',
    ]);
  });

  it('flags empty stages and commands without arguments as errors', () => {
    expect(problems('fields a |')).toEqual(['1:10 Expected a command after |']);
    expect(problems('fields a | | limit 5')).toEqual(['1:10 Expected a command after |']);
    expect(problems('fields a | sort')).toEqual(['1:12 "sort" needs arguments']);
    expect(problems('fields a | 42')).toEqual(['1:12 Expected a command, found 42']);
  });

  it('flags unclosed strings, regexes, backticks and brackets as errors', () => {
    expect(problems("filter a = 'x")).toEqual(["1:12 Unclosed string: ' has no closing pair"]);
    expect(problems('filter a like /x')).toEqual(['1:15 Unclosed regex: / has no closing pair on this line']);
    expect(problems('fields `a-b')).toEqual(['1:8 Unclosed backtick: ` has no closing pair on this line']);
    expect(problems('stats count(* by x')).toEqual(['1:12 Unclosed (']);
    expect(problems('fields a)')).toEqual(['1:9 Unexpected ): there is no ( for it to close']);
  });

  it('flags a bad limit', () => {
    expect(problems('fields a | limit 0')).toEqual(['1:18 limit must be a whole number greater than 0']);
    expect(problems('fields a | limit 10 20')).toEqual(['1:21 limit takes a single number']);
    expect(problems('fields a | limit any')).toEqual(['1:18 limit any needs a number']);
  });

  it('flags commands out of their documented order', () => {
    expect(problems('stats count(*) by a | sort a | stats count(*)')).toEqual([
      '1:23 sort must come after the last stats',
    ]);
    expect(problems('fields a | estimate | limit 5')).toEqual(['1:12 estimate must be the last command']);
  });

  it('checks subqueries like the query itself', () => {
    expect(problems("filter id in (SOURCE 'g' | sort x ascs | fields id)")).toEqual([
      '1:35 Expected asc or desc, found "ascs". Did you mean "asc"?',
    ]);
  });

  describe('warnings: not in the documented vocabulary', () => {
    it('unknown commands, typo or not: AWS keeps adding commands', () => {
      expect(problems('fields a | fitler a = 1', 'warning')).toEqual([
        '1:12 Unknown command "fitler". Did you mean "filter"?',
      ]);
      expect(problems('fields a | hfbvf x', 'warning')).toEqual(['1:12 Unknown command "hfbvf"']);
      expect(problems('fields a | severity != "Debug"', 'warning')).toEqual([
        '1:12 Unknown command "severity". Missing "filter"?',
      ]);
    });

    it('unknown functions', () => {
      expect(problems('stats cnt(*)', 'warning')).toEqual(['1:7 Unknown function "cnt". Did you mean "count"?']);
      expect(problems('fields mystery(a)', 'warning')).toEqual(['1:8 Unknown function "mystery"']);
    });

    it('operators from other languages', () => {
      expect(problems('filter a == 1 && b = 2 || c = 3', 'warning')).toEqual([
        '1:10 Logs Insights uses =, not ==',
        '1:15 Logs Insights uses and, not &&',
        '1:24 Logs Insights uses or, not ||',
      ]);
    });

    it('a limit above the documented maximum', () => {
      expect(problems('fields a | limit 200000', 'warning')).toEqual(['1:18 limit can be at most 100,000']);
    });
  });

  describe('hints: valid, but often a mistake', () => {
    it('a hyphenated field name without backticks', () => {
      expect(problems('fields request-id', 'hint')).toEqual([
        '1:8 This is request minus id. A field name with a hyphen needs backticks: `request-id`',
      ]);
    });

    it('a string that runs over lines', () => {
      expect(problems("filter a = 'x\n| filter b = 'y'")).toEqual([
        "1:12 This string goes on to line 2. Is a closing ' missing?",
        "2:16 Unclosed string: ' has no closing pair",
      ]);
    });
  });
});
