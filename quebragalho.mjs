#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const harnesses = ['claude', 'codex', 'opencode', 'aider', 'pi'];

async function configuration(harness, base, model, models) {
  const env = { ...process.env };
  const key = env.QUEBRAGALHO_API_KEY;
  let args = ['--model', model];
  let temporary;
  switch (harness) {
    case 'claude':
      Object.assign(env, { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: model, CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' });
      for (const name of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[name];
      break;
    case 'codex': {
      const provider = { name: 'Quebra-galho', base_url: `${base}/v1`, env_key: 'QUEBRAGALHO_API_KEY',
        wire_api: 'responses', requires_openai_auth: false };
      // JSON-quoted strings are also valid TOML basic strings.
      args = ['-c', 'model_provider="quebragalho"', ...Object.entries(provider).flatMap(([name, value]) =>
        ['-c', `model_providers.quebragalho.${name}=${JSON.stringify(value)}`]), '--model', model];
      break;
    }
    case 'opencode': {
      const existing = env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {};
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...existing, model: `quebragalho/${model}`,
        provider: { ...existing.provider, quebragalho: { name: 'Quebra-galho', npm: '@ai-sdk/openai-compatible',
          options: { baseURL: `${base}/v1`, apiKey: '{env:QUEBRAGALHO_API_KEY}' },
          models: Object.fromEntries(models.map(id => [id, { name: id }])) } } });
      args = ['--model', `quebragalho/${model}`];
      break;
    }
    case 'aider':
      Object.assign(env, { OPENAI_API_BASE: `${base}/v1`, OPENAI_API_KEY: key });
      args = ['--model', `openai/${model}`];
      break;
    case 'pi': {
      temporary = await mkdtemp(join(tmpdir(), 'quebragalho-pi-'));
      const extension = join(temporary, 'provider.mjs');
      try {
        // ponytail: conservative text-only limits; use verified gateway metadata when provided.
        const provider = { baseUrl: `${base}/v1`, api: 'openai-completions', apiKey: '$QUEBRAGALHO_API_KEY',
          models: models.map(id => ({ id, name: id, reasoning: false, input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 })) };
        await writeFile(extension, `export default function(pi) { pi.registerProvider("quebragalho", ${JSON.stringify(provider)}); }\n`, { mode: 0o600 });
      } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
      args = ['--extension', extension, '--provider', 'quebragalho', '--model', model];
      break;
    }
  }
  return { env, args, temporary };
}

async function main() {
  const args = process.argv.slice(2);
  const helpArgs = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  if (!args.length || helpArgs.includes('--help')) {
    console.log(`Uso: quebragalho launch [${harnesses.join('|')}] [--model ID] [-- argumentos do harness]\nquebragalho list\nConfigure QUEBRAGALHO_BASE_URL e QUEBRAGALHO_API_KEY no ambiente.`);
    return;
  }
  if (args[0] === 'list' && args.length === 1) { console.log(harnesses.join('\n')); return; }
  if (args.shift() !== 'launch') throw new Error('Use quebragalho launch.');
  let harness = args[0]?.startsWith('--') ? undefined : args.shift();
  if (!harness && process.stdin.isTTY) {
    harnesses.forEach((name, i) => console.log(`${i + 1}. ${name}`));
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const choice = (await prompt.question('Escolha um harness: ')).trim();
      harness = /^\d+$/.test(choice) ? harnesses[Number(choice) - 1] : choice;
    } finally { prompt.close(); }
  }
  if (!harnesses.includes(harness)) throw new Error(`Harness inválido. Opções: ${harnesses.join(', ')}.`);
  const separator = args.indexOf('--');
  const forwarded = separator < 0 ? [] : args.splice(separator).slice(1);
  let model;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--model' || !args[1]) throw new Error('Use --model ID e -- antes dos argumentos do Claude.');
    model = args[1];
  }
  const rawUrl = process.env.QUEBRAGALHO_BASE_URL;
  const key = process.env.QUEBRAGALHO_API_KEY;
  if (!rawUrl || !key) throw new Error('Configure QUEBRAGALHO_BASE_URL e QUEBRAGALHO_API_KEY.');
  const url = new URL(rawUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('URL base não pode conter credenciais, query ou fragmento.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS (HTTP somente em loopback local).');
  const base = url.href.replace(/\/$/, '');
  const response = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Catálogo indisponível: HTTP ${response.status}.`);
  const catalog = await response.json();
  if (!Array.isArray(catalog.data) || !catalog.data.length || catalog.data.some(x => typeof x?.id !== 'string' || !x.id.trim())) throw new Error('Catálogo inválido ou vazio.');
  const models = [...new Set(catalog.data.map(x => x.id))];
  if (!model && process.stdin.isTTY && models.length > 1) {
    models.forEach((id, i) => console.log(`${i + 1}. ${id}`));
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const choice = (await prompt.question('Escolha um modelo [1]: ')).trim() || '1';
      if (!/^\d+$/.test(choice) || !models[Number(choice) - 1]) throw new Error('Escolha inválida.');
      model = models[Number(choice) - 1];
    } finally { prompt.close(); }
  }
  if (!model && models.length > 1) throw new Error('Sem terminal interativo: informe --model ID.');
  model ??= models[0];
  if (!models.includes(model)) throw new Error('Modelo não encontrado no catálogo.');
  const { env, args: launchArgs, temporary } = await configuration(harness, base, model, models);
  // Pass credentials through the environment, never command-line arguments.
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(harness, [...launchArgs, ...forwarded], { env, stdio: 'inherit', shell: false });
      const forwardInt = () => child.kill('SIGINT');
      const forwardTerm = () => child.kill('SIGTERM');
      process.on('SIGINT', forwardInt);
      process.on('SIGTERM', forwardTerm);
      const release = () => {
        process.removeListener('SIGINT', forwardInt);
        process.removeListener('SIGTERM', forwardTerm);
      };
      child.on('error', () => { release(); reject(new Error(`${harness} não encontrado ou não pôde iniciar. Instale o harness primeiro.`)); });
      child.on('exit', (code, signal) => { release(); resolve({ code, signal }); });
    });
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}
main().catch(error => {
  // Provider bodies, URLs and credentials must not leak through errors.
  const message = error.name === 'Error' ? error.message : 'Confira URL, conexão e configuração JSON.';
  console.error(`quebragalho: ${message}`);
  process.exitCode = 1;
});
