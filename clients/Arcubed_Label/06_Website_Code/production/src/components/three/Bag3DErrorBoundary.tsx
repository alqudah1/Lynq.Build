"use client";

// Must be a class component — React error boundaries have no hook
// equivalent. Catches GLTF fetch/parse failures and WebGL context loss from
// anywhere in the 3D tree beneath it, so one bad asset degrades to the
// caller's photo/BagArt fallback instead of taking down the product page.

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
}

export default class Bag3DErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
