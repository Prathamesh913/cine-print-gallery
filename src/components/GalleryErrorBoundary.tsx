import React, { Component, ErrorInfo, ReactNode } from "react";
import { Film, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GalleryErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in gallery content:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex w-full min-h-[40vh] flex-col items-center justify-center py-12 text-center">
          <div className="relative mb-6 text-white/20 animate-pulse">
            <Film size={64} strokeWidth={1} />
            <div className="absolute -bottom-2 -right-2 text-[#FF6B6B]">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
          </div>
          <h2 
            className="text-2xl font-bold tracking-tight text-[#F5F5F5] mb-2 font-heading"
          >
            Scene Interrupted: Rendering Error
          </h2>
          <p className="max-w-md text-white/50 text-sm mb-8 leading-relaxed">
            A glitch occurred while loading this portion of the gallery. This is usually due to temporary feed inconsistencies.
          </p>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-full bg-[#FF6B6B] px-6 py-2.5 text-xs font-semibold text-[#121212] transition hover:bg-[#FF8585] active:scale-95 shadow-lg shadow-[#FF6B6B]/25 cursor-pointer"
          >
            <RotateCw size={14} />
            RETRY PREVIEW
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
