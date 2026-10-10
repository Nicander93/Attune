// Runs a command with the native tools whisper-rs needs to build on Windows:
// - CMake: from PATH, otherwise the copy bundled with Visual Studio Build Tools (via vswhere).
// - libclang (for bindgen): LIBCLANG_PATH, an LLVM install, or the `libclang` Python package.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLED_CMAKE = ['Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin'];
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';

function succeeds(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}

function output(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function visualStudioCmake() {
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) return undefined;
  return output(vswhere, ['-all', '-products', '*', '-property', 'installationPath'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((dir) => join(dir, ...BUNDLED_CMAKE, 'cmake.exe'))
    .find(existsSync);
}

function libclangDirectory() {
  const llvm = [join(programFiles, 'LLVM', 'bin'), join(programFilesX86, 'LLVM', 'bin')];
  const python = output('python', [
    '-c',
    'import clang, os; print(os.path.join(os.path.dirname(clang.__file__), "native"))',
  ]).trim();
  return [...llvm, python].find((dir) => dir && existsSync(join(dir, 'libclang.dll')));
}

const env = { ...process.env };
if (process.platform === 'win32') {
  if (!env.CMAKE && !succeeds('cmake', ['--version'])) {
    const cmake = visualStudioCmake();
    if (cmake) env.CMAKE = cmake;
    else console.warn('未找到 CMake：请安装 CMake，或安装带 C++ 桌面开发组件的 VS Build Tools。');
  }
  if (!env.LIBCLANG_PATH) {
    const libclang = libclangDirectory();
    if (libclang) env.LIBCLANG_PATH = libclang;
    else console.warn('未找到 libclang：请安装 LLVM，或执行 pip install libclang。');
  }
}
const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
