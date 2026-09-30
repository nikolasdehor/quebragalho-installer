import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

test('installer and installed launch preserve arguments, environment and failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quebragalho-test-'));
  try {
    // Mock only transport: execute the actual installed launcher and child binaries.
    const preload = join(dir, 'transport.mjs');
    await writeFile(preload, `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://gateway.example/v1/models');
        assert.equal(options.headers.Authorization, 'Bearer test-secret');
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal);
        if (process.env.MOCK_NETWORK_ERROR) throw new TypeError('test-secret');
        return new Response(process.env.MOCK_BODY || JSON.stringify({data:[{id:'model-a'},{id:'model-b'}]}),
          {status: Number(process.env.MOCK_STATUS || 200)});
      };
    `);
    const capture = join(dir, 'capture.json');
    const fake = `#!/usr/bin/env node\nconst fs = require('node:fs'); const args=process.argv.slice(2); const extension=args.includes('--extension') ? args[args.indexOf('--extension')+1] : undefined; fs.writeFileSync(process.env.CAPTURE, JSON.stringify({args,base:process.env.ANTHROPIC_BASE_URL,token:process.env.ANTHROPIC_AUTH_TOKEN,api:process.env.ANTHROPIC_API_KEY,discovery:process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,bedrock:process.env.CLAUDE_CODE_USE_BEDROCK,openaiBase:process.env.OPENAI_API_BASE,openaiKey:process.env.OPENAI_API_KEY,opencode:process.env.OPENCODE_CONFIG_CONTENT,extension:extension ? fs.readFileSync(extension,'utf8') : undefined}));if(process.env.MOCK_SIGNAL) process.kill(process.pid,'SIGTERM'); else if(process.env.MOCK_WAIT) setInterval(()=>{},1000); else process.exit(7);\n`;
    for (const name of ['claude', 'codex', 'opencode', 'aider', 'pi']) await writeFile(join(dir, name), fake, { mode: 0o755 });
    const env = { QUEBRAGALHO_BIN_DIR: dir, PATH: `${dir}:${process.env.PATH}`, CAPTURE: capture,
      NODE_OPTIONS: `--import=${preload}`, QUEBRAGALHO_BASE_URL: 'https://gateway.example', QUEBRAGALHO_API_KEY: 'test-secret', CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '',
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '', OPENAI_API_BASE: '', OPENAI_API_KEY: '', OPENCODE_CONFIG_CONTENT: '' };
    assert.equal((await run('sh', ['install.sh'], env)).code, 0);
    const installed = join(dir, 'quebragalho');
    const original = await readFile(installed, 'utf8');
    assert.equal((await run('sh', ['install.sh'], env)).code, 1);
    assert.equal(await readFile(installed, 'utf8'), original);
    assert.equal((await run(installed, ['--help'], env)).code, 0);
    assert.deepEqual((await run(installed, ['list'], env)).output.trim().split('\n'), ['claude', 'codex', 'opencode', 'aider', 'pi']);
    const result = await run(installed, ['launch', 'claude', '--model', 'model-b', '--', '-p', 'hello world; $(echo nope)'], env);
    assert.equal(result.code, 7);
    const claude = JSON.parse(await readFile(capture, 'utf8'));
    assert.deepEqual(claude.args, ['--model', 'model-b', '-p', 'hello world; $(echo nope)']);
    assert.equal(claude.base, env.QUEBRAGALHO_BASE_URL);
    assert.equal(claude.token, 'test-secret');
    assert.equal(claude.api, '');
    assert.equal(claude.discovery, '1');
    assert.equal(claude.bedrock, undefined);
    assert.equal((await run(installed, ['launch', 'claude', '--model', 'model-b', '--', '--help'], env)).code, 7);
    assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')).args, ['--model', 'model-b', '--help']);
    for (const harness of ['codex', 'opencode', 'aider', 'pi']) {
      const outcome = await run(installed, ['launch', harness, '--model', 'model-b', '--', '--help'], env);
      assert.equal(outcome.code, 7, outcome.output);
      const captured = JSON.parse(await readFile(capture, 'utf8'));
      assert.equal(captured.args.at(-1), '--help');
      assert.ok(!captured.args.join(' ').includes('test-secret'));
      if (harness === 'codex') {
        assert.ok(captured.args.includes('model_provider="quebragalho"'));
        assert.ok(captured.args.includes('model_providers.quebragalho.wire_api="responses"'));
        assert.ok(captured.args.includes('model_providers.quebragalho.env_key="QUEBRAGALHO_API_KEY"'));
        assert.ok(captured.args.includes('model_providers.quebragalho.base_url="https://gateway.example/v1"'));
      }
      if (harness === 'opencode') {
        const config = JSON.parse(captured.opencode);
        assert.equal(config.model, 'quebragalho/model-b');
        assert.deepEqual(Object.keys(config.provider.quebragalho.models), ['model-a', 'model-b']);
        assert.equal(config.provider.quebragalho.options.apiKey, '{env:QUEBRAGALHO_API_KEY}');
      }
      if (harness === 'aider') {
        assert.equal(captured.openaiBase, 'https://gateway.example/v1');
        assert.equal(captured.openaiKey, 'test-secret');
        assert.deepEqual(captured.args, ['--model', 'openai/model-b', '--help']);
      }
      if (harness === 'pi') {
        let provider;
        const extension = await import(`data:text/javascript,${encodeURIComponent(captured.extension)}`);
        extension.default({ registerProvider: (name, value) => { assert.equal(name, 'quebragalho'); provider = value; } });
        assert.equal(provider.apiKey, '$QUEBRAGALHO_API_KEY');
        assert.equal(provider.api, 'openai-completions');
        assert.equal(provider.models.length, 2);
        await assert.rejects(readFile(captured.args[1]), { code: 'ENOENT' });
      }
    }
    const signaled = await run(installed, ['launch', 'pi', '--model', 'model-b'], { ...env, MOCK_SIGNAL: '1' });
    assert.equal(signaled.signal, 'SIGTERM');
    const interrupted = JSON.parse(await readFile(capture, 'utf8'));
    await assert.rejects(readFile(interrupted.args[1]), { code: 'ENOENT' });
    await rm(capture);
    const running = spawn(installed, ['launch', 'pi', '--model', 'model-b'], {
      env: { ...process.env, ...env, MOCK_WAIT: '1' }, stdio: 'ignore',
    });
    try {
      const closed = new Promise(resolve => running.on('close', (code, signal) => resolve({ code, signal })));
      let active;
      for (let i = 0; i < 100; i++) {
        try { active = JSON.parse(await readFile(capture, 'utf8')); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 20)); }
      }
      assert.ok(active, 'Pi child started');
      running.kill('SIGTERM');
      assert.equal((await closed).signal, 'SIGTERM');
      await assert.rejects(readFile(active.args[1]), { code: 'ENOENT' });
    } finally { running.kill('SIGKILL'); }
    await rm(join(dir, 'pi'));
    assert.equal((await run(installed, ['launch', 'pi', '--model', 'model-b'], env)).code, 1);
    for (const [args, overrides] of [
      [['launch', 'claude'], {}],
      [['launch', 'claude', '--model', 'missing'], {}],
      [['launch', 'claude'], { QUEBRAGALHO_API_KEY: '' }],
      [['launch', 'claude'], { QUEBRAGALHO_BASE_URL: 'http://example.com' }],
      [['launch', 'bogus'], {}],
      [['launch', 'claude'], { QUEBRAGALHO_BASE_URL: 'https://user:pass@gateway.example' }],
      [['launch', 'claude', '--model', 'model-a'], { MOCK_NETWORK_ERROR: '1' }],
      [['launch', 'claude', '--model', 'model-a'], { MOCK_BODY: '{"data":[]}' }],
      [['launch', 'claude', '--model', 'model-a'], { MOCK_BODY: 'invalid JSON' }],
    ]) {
      const failure = await run(installed, args, { ...env, ...overrides });
      assert.equal(failure.code, 1);
      assert.ok(!failure.output.includes('test-secret'));
    }
    assert.equal((await run(installed, ['launch', 'claude', '--model', 'model-a'], { ...env, MOCK_STATUS: '401' })).code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
