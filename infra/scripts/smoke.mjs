#!/usr/bin/env node
/**
 * Read-only smoke checks (house rule: reads and refusal paths only).
 * Run with AWS_PROFILE=jamie after any deploy.
 */

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: 'elixir-mcp' }));
const outputs = Object.fromEntries(Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]));
let failures = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check('stack status', ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(Stacks[0].StackStatus), Stacks[0].StackStatus);

// MCP door: discovery must be served; /mcp must REFUSE without a bearer.
const mcpBase = `https://${outputs.McpDistributionDomain}`;
const discovery = await fetch(`${mcpBase}/.well-known/oauth-authorization-server`);
check('oauth discovery', discovery.ok, String(discovery.status));
const meta = discovery.ok ? await discovery.json() : {};
check('issuer', meta.issuer === 'https://mcp.poapkings.com', meta.issuer);
const bare = await fetch(`${mcpBase}/mcp`, { method: 'POST', body: '{}' });
check('mcp refuses without bearer', bare.status === 401, String(bare.status));
check('www-authenticate present', (bare.headers.get('www-authenticate') ?? '').includes('resource_metadata'));

// Site: the shell must serve.
const site = await fetch(`https://${outputs.SiteDistributionDomain}/`);
check('site shell', site.ok, String(site.status));
const html = site.ok ? await site.text() : '';
check('site is the app', html.includes('Elixir MCP'));

process.exit(failures === 0 ? 0 : 1);
