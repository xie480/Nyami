import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DESKTOP_PACKAGE_PATH = path.join(
  PROJECT_ROOT,
  'desktop',
  'package.json',
);
const RELEASE_DIRECTORY = path.join(PROJECT_ROOT, 'release', 'desktop');
const DESKTOP_OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'desktop', 'out');

/**
 * 读取桌面端版本，并保证发布脚本只使用桌面 package.json 的版本号。
 * @returns 桌面端语义化版本
 */
async function readDesktopVersion() {
  const content = await fs.readFile(DESKTOP_PACKAGE_PATH, 'utf8');
  const packageJson = JSON.parse(content);
  if (!isVersion(packageJson.version)) {
    throw new Error('desktop/package.json 的 version 不是有效的语义化版本');
  }
  return packageJson.version;
}

/**
 * 生成安装包校验和与手动更新清单。
 * @returns 无返回值
 */
async function generateReleaseMetadata() {
  const version = await readDesktopVersion();
  const artifacts = await listArtifacts();
  const setupArtifact = artifacts.find(name => /-setup\.exe$/i.test(name));
  const portableArtifact = artifacts.find(name => /-portable\.exe$/i.test(name));
  if (!setupArtifact || !portableArtifact) {
    throw new Error('发布目录缺少 x64 NSIS 安装包或便携版');
  }

  const checksums = await Promise.all(
    artifacts.map(async artifact => ({
      artifact,
      sha256: await calculateSha256(path.join(RELEASE_DIRECTORY, artifact)),
    })),
  );
  const blockmapArtifact = artifacts.find(name => name.endsWith('.blockmap'));
  const notesPath = path.join(
    PROJECT_ROOT,
    'release',
    `RELEASE_NOTES_windows_v${version}.md`,
  );
  const notes = await readOptionalText(notesPath);
  const manifest = {
    version,
    channel: 'stable',
    releaseDate: new Date().toISOString(),
    notes: notes || `Nyami Windows ${version} 发布。`,
    url: setupArtifact,
    portableUrl: portableArtifact,
    sha256: checksums.find(item => item.artifact === setupArtifact)?.sha256,
    blockmapUrl: blockmapArtifact || null,
  };

  await fs.writeFile(
    path.join(RELEASE_DIRECTORY, 'latest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(RELEASE_DIRECTORY, 'SHA256SUMS.txt'),
    `${checksums
      .map(item => `${item.sha256}  ${item.artifact}`)
      .join('\n')}\n`,
    'utf8',
  );
  console.log(
    `已生成 Nyami ${version} 发布清单、SHA-256 校验和和增量 blockmap 引用。`,
  );
}

/**
 * 校验构建产物是否满足发布质量门槛。
 * @returns 无返回值
 */
async function checkReleaseArtifacts() {
  const version = await readDesktopVersion();
  await assertNoDebugFiles(DESKTOP_OUTPUT_DIRECTORY);
  const artifacts = await listArtifacts();
  if (!artifacts.some(name => /-setup\.exe$/i.test(name))) {
    throw new Error('未找到 NSIS 安装包');
  }
  if (!artifacts.some(name => /-portable\.exe$/i.test(name))) {
    throw new Error('未找到便携版');
  }
  const manifestPath = path.join(RELEASE_DIRECTORY, 'latest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.version !== version) {
    throw new Error('latest.json 版本与 desktop/package.json 不一致');
  }
  if (!isVersion(manifest.version) || !isSha256(manifest.sha256)) {
    throw new Error('latest.json 缺少有效版本或安装包 SHA-256');
  }
  const setupPath = path.join(RELEASE_DIRECTORY, manifest.url);
  const actualSha256 = await calculateSha256(setupPath);
  if (actualSha256 !== manifest.sha256) {
    throw new Error('latest.json 中的安装包 SHA-256 校验失败');
  }
  const checksumPath = path.join(RELEASE_DIRECTORY, 'SHA256SUMS.txt');
  await fs.access(checksumPath);
  console.log(
    `发布质量检查通过：${version}，x64 安装包、便携版、校验和和更新清单均存在。`,
  );
}

/**
 * 列出当前发布目录中的可分发二进制和 blockmap 文件。
 * @returns 产物文件名列表
 */
async function listArtifacts() {
  const entries = await fs.readdir(RELEASE_DIRECTORY, {withFileTypes: true});
  return entries
    .filter(
      entry =>
        entry.isFile() &&
        (entry.name.endsWith('.exe') || entry.name.endsWith('.blockmap')),
    )
    .map(entry => entry.name)
    .sort();
}

/**
 * 检查构建目录和发布目录中的调试残留。
 * @param directory 待检查目录
 * @returns 检查完成后的 Promise
 */
async function assertNoDebugFiles(directory) {
  const entries = await readFilesRecursively(directory);
  const forbidden = entries.filter(filePath => {
    const lower = filePath.toLowerCase();
    return (
      lower.endsWith('.map') ||
      lower.endsWith('.log') ||
      lower.includes('test-credentials') ||
      lower.includes('fixture-credential')
    );
  });
  if (forbidden.length) {
    throw new Error(`发布目录包含调试或测试凭证文件：${forbidden.join(', ')}`);
  }
}

/**
 * 递归读取目录中的文件路径。
 * @param directory 根目录
 * @returns 文件绝对路径列表
 */
async function readFilesRecursively(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, {withFileTypes: true});
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readFilesRecursively(entryPath)));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

/**
 * 计算文件的 SHA-256 摘要。
 * @param filePath 文件绝对路径
 * @returns 小写十六进制摘要
 */
async function calculateSha256(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 读取可选的发布说明文件。
 * @param filePath 文件绝对路径
 * @returns 文件内容；文件不存在时返回空字符串
 */
async function readOptionalText(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/**
 * 判断版本是否符合本项目使用的语义化版本格式。
 * @param value 待校验值
 * @returns 是否为有效版本
 */
function isVersion(value) {
  return (
    typeof value === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

/**
 * 判断字符串是否为 SHA-256 摘要。
 * @param value 待校验值
 * @returns 是否为有效摘要
 */
function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

const checkOnly = process.argv.includes('--check');
const action = checkOnly ? checkReleaseArtifacts : generateReleaseMetadata;
action().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
