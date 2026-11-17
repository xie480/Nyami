import {app} from 'electron';
import {AppLogger} from '../logging/appLogger';

/**
 * 将未知异常转换为不包含敏感字段的日志对象。
 * @param value 未知异常值
 * @returns 可写入本地日志的错误摘要
 */
export function describeProcessError(value: unknown): Record<string, string> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? '',
    };
  }
  return {
    name: 'UnknownError',
    message: String(value),
    stack: '',
  };
}

/**
 * 安装主进程异常边界。
 * 未捕获异常和未处理 Promise 拒绝会先写脱敏日志，再请求 Electron 安全退出。
 * @param logger 本地日志器
 * @returns 卸载监听器的函数
 */
export function installProcessErrorBoundary(logger: AppLogger): () => void {
  let fatalHandled = false;
  let quitTimer: NodeJS.Timeout | null = null;

  const requestSafeQuit = (): void => {
    if (fatalHandled) {
      return;
    }
    fatalHandled = true;
    const quit = (): void => {
      try {
        app.quit();
      } catch {
        app.exit(1);
      }
    };
    if (app.isReady()) {
      quitTimer = setTimeout(quit, 0);
      return;
    }
    app.once('ready', quit);
  };

  const onUncaughtException = (error: Error): void => {
    logger.error('process.uncaught-exception', describeProcessError(error));
    requestSafeQuit();
  };

  const onUnhandledRejection = (reason: unknown): void => {
    logger.error(
      'process.unhandled-rejection',
      describeProcessError(reason),
    );
    requestSafeQuit();
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  return (): void => {
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
    if (quitTimer) {
      clearTimeout(quitTimer);
      quitTimer = null;
    }
  };
}
