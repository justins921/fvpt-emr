import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render errors in its subtree and shows a fallback instead of
 * unmounting the entire app (white screen). Used around sections that render
 * server-driven data (claim scrub results, etc.).
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Something went wrong rendering this section.',
    };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render error:', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-sm">
          <div className="font-semibold text-red-700">Couldn't display this section</div>
          <div className="mt-1 text-xs text-red-600">{this.state.message}</div>
          {this.props.onReset && (
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onReset?.();
              }}
              className="mt-2 text-xs text-red-700 underline"
            >
              Dismiss
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
