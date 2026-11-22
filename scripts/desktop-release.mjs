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
const SETUP_ARTIFACT_NAME = 'NYAMI-Setup-x64.exe';

/**
 * 清理仓库内的桌面发布生成目录，不触碰 Electron userData 或其他用户数据。
 * @returns 清理完成后的 Promise
 */
async function cleanReleaseArtifacts() {
  await fs.rm(RELEASE_DIRECTORY, {recursive: true, force: true});
  await fs.mkdir(RELEASE_DIRECTORY, {recursive: true});
  console.log(`已清理桌面发布生成目录：${RELEASE_DIRECTORY}`);
}

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
  await assertNoDebugFiles(DESKTOP_OUTPUT_DIRECTORY);
  const artifacts = await listArtifacts();
  assertOnlySetupArtifact(artifacts);

  const checksums = await Promise.all(
    artifacts.map(async artifact => ({
      artifact,
      sha256: await calculateSha256(path.join(RELEASE_DIRECTORY, artifact)),
    })),
  );
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
    notes: notes || `NYAMI Windows ${version} 发布。`,
    url: SETUP_ARTIFACT_NAME,
    sha256: checksums.find(item => item.artifact === SETUP_ARTIFACT_NAME)?.sha256,
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
    `已生成 NYAMI ${version} 发布清单和 SHA-256 校验和。`,
  );
}

/**
 * 校验构建产物是否满足发布质量门槛。
 * @returns 无返回值
 */
async function checkReleaseArtifacts() {
  const version = await readDesktopVersion();
  await assertNoDebugFiles(DESKTOP_OUTPUT_DIRECTORY);
  await assertNoDebugFiles(RELEASE_DIRECTORY);
  const artifacts = await listArtifacts();
  assertOnlySetupArtifact(artifacts);
  const manifestPath = path.join(RELEASE_DIRECTORY, 'latest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.version !== version) {
    throw new Error('latest.json 版本与 desktop/package.json 不一致');
  }
  if (manifest.url !== SETUP_ARTIFACT_NAME) {
    throw new Error(`latest.json 必须指向 ${SETUP_ARTIFACT_NAME}`);
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
    `发布质量检查通过：${version}，仅有 x64 NSIS 安装包及其校验和、更新清单。`,
  );
}

/**
 * 确认发布目录只包含正式 Setup.exe，防止旧 portable 或其他分发格式混入发布结果。
 * @param artifacts 发布目录中的可分发产物
 * @returns 无返回值
 */
function assertOnlySetupArtifact(artifacts) {
  if (artifacts.length !== 1 || artifacts[0] !== SETUP_ARTIFACT_NAME) {
    throw new Error(
      `发布目录必须只包含 ${SETUP_ARTIFACT_NAME}，当前产物：${artifacts.join(', ') || '无'}`,
    );
  }
}

/**
 * 列出当前发布目录中的可分发 Windows 可执行文件。
 * @returns 产物文件名列表
 */
async function listArtifacts() {
  const entries = await fs.readdir(RELEASE_DIRECTORY, {withFileTypes: true});
  return entries
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith('.exe'),
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

const cleanOnly = process.argv.includes('--clean');
const checkOnly = process.argv.includes('--check');
const action = cleanOnly
  ? cleanReleaseArtifacts
  : checkOnly
    ? checkReleaseArtifacts
    : generateReleaseMetadata;
action().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
