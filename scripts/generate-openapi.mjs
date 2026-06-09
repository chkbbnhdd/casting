import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const specs = [
  {
    name: 'display-fe-axis-https',
    input: 'https://dr-dev-api-display-fe-axis.drtv-npd.deltatre.digital/swagger/v0.1/swagger.json',
  },
  {
    name: 'display-fe-axis-http',
    input: 'http://dr-dev-api-display-fe-axis.drtv-npd.deltatre.digital/swagger/v0.1/swagger.json',
  },
  {
    name: 'video-v1',
    input: 'https://dr-dev-video.drtv-npd.deltatre.digital/swagger/v1/swagger.json',
  },
];

const apiRoot = resolve(process.cwd(), 'src', 'api');
mkdirSync(apiRoot, { recursive: true });

const cacheRoot = resolve(process.cwd(), '.openapi-cache');
mkdirSync(cacheRoot, { recursive: true });

const failures = [];

async function downloadSpec(spec) {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(spec.input, { signal: timeout });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  let normalized = raw;

  try {
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object') {
      if (!parsed.info) {
        parsed.info = {};
      }
      if (!parsed.info.version) {
        parsed.info.version = '0.0.0';
      }

      const paths = parsed.paths;
      if (paths && typeof paths === 'object') {
        for (const pathItem of Object.values(paths)) {
          if (!pathItem || typeof pathItem !== 'object') {
            continue;
          }

          for (const operation of Object.values(pathItem)) {
            if (!operation || typeof operation !== 'object') {
              continue;
            }

            const responses = operation.responses;
            if (!responses || typeof responses !== 'object') {
              continue;
            }

            if (Object.prototype.hasOwnProperty.call(responses, '0')) {
              if (!Object.prototype.hasOwnProperty.call(responses, 'default')) {
                responses.default = responses['0'];
              }
              delete responses['0'];
            }
          }
        }
      }
    }

    normalized = JSON.stringify(parsed, null, 2);
  } catch {
    // Keep original content if parsing fails.
  }

  const localPath = resolve(cacheRoot, `${spec.name}.json`);
  writeFileSync(localPath, normalized, 'utf8');
  return localPath;
}

for (const spec of specs) {
  const outDir = resolve(apiRoot, spec.name);
  let inputPath;

  try {
    inputPath = await downloadSpec(spec);
  } catch (error) {
    failures.push(spec.name);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to download ${spec.name} from ${spec.input}: ${message}`);
    continue;
  }

  const args = [
    'openapi-generator-cli',
    'generate',
    '-g',
    'typescript-angular',
    '-i',
    inputPath,
    '-o',
    outDir,
    '--skip-validate-spec',
    '--additional-properties',
    'providedInRoot=true,stringEnums=true,withInterfaces=true',
  ];

  console.log(`\nGenerating ${spec.name} from ${spec.input}`);
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    failures.push(spec.name);
    console.error(`Failed to generate ${spec.name} (exit code: ${result.status ?? 1})`);
    continue;
  }

  console.log(`Generated ${spec.name} into ${outDir}`);
}

if (failures.length > 0) {
  console.error(`\nCompleted with failures for: ${failures.join(', ')}`);
  console.error(`Generated successful specs under: ${apiRoot}`);
  process.exit(1);
}

console.log(`\nDone. APIs generated under: ${apiRoot}`);
