import React, {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Renderer 根错误边界。
 * 捕获 React 渲染异常，向主进程发送脱敏摘要并提供安全恢复入口。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  };

  /**
   * 将错误转换为错误边界状态，停止继续渲染损坏的组件树。
   * @param error React 捕获的异常
   * @returns 更新后的错误边界状态
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
    };
  }

  /**
   * 记录 Renderer 异常并交给主进程统一脱敏落盘。
   * @param error React 捕获的异常
   * @param errorInfo React 组件栈信息
   * @returns 无返回值
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void window.nyamiDesktop?.logs
      .reportRendererError({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack ?? undefined,
      })
      .catch(() => undefined);
  }

  /**
   * 渲染正常子树或安全错误页面。
   * @returns React 元素
   */
  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <main className="app-shell error-shell">
        <section className="card error-card" role="alert">
          <p className="eyebrow">RENDERER ERROR</p>
          <h1>页面遇到问题</h1>
          <p className="muted">
            错误摘要已交给主进程本地日志。可以重新加载桌面页面继续使用。
          </p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
            type="button">
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
