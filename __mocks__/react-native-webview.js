// Manual mock for react-native-webview to avoid native module errors in Jest tests
// Provides a simple WebView component that renders its children.
import React from 'react';

export const WebView = (props) => {
  // Render children directly; ignore URL loading logic.
  return <React.Fragment>{props.children}</React.Fragment>;
};

export default {
  WebView,
};
