import {defineConfig} from 'electron-vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

const desktopRoot = resolve(__dirname);

/**
 * Electron 主进程、preload 与 React DOM Renderer 的独立构建配置。
 * 输入目录保持在 desktop/，不改变现有 React Native src/ 入口。
 */
export default defineConfig({
  main: {
    build: {
      sourcemap: false,
      // 安装包只收集 desktop/out，主进程使用的第三方依赖必须内联。
      externalizeDeps: {
        exclude: ['md5', 'qrcode'],
      },
      lib: {
        entry: resolve(desktopRoot, 'main/index.ts'),
      },
      outDir: resolve(desktopRoot, 'out/main'),
    },
  },
  preload: {
    build: {
      sourcemap: false,
      lib: {
        entry: resolve(desktopRoot, 'preload/index.ts'),
      },
      outDir: resolve(desktopRoot, 'out/preload'),
    },
  },
  renderer: {
    root: resolve(desktopRoot, 'renderer'),
    plugins: [react()],
    build: {
      sourcemap: false,
      outDir: resolve(desktopRoot, 'out/renderer'),
      rolldownOptions: {
        input: 'index.html',
      },
    },
  },
});
