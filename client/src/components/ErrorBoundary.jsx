// Last line of defence against a blank page. Without a boundary, any error
// thrown while rendering unmounts the entire React tree and leaves an empty
// <div id="root">, with the only clue sitting in the browser console.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Chatter crashed while rendering', error, info.componentStack);
  }

  handleReset = () => {
    // A stale or broken session is the most likely cause, so start clean.
    localStorage.removeItem('chatter_token');
    window.location.assign('/login');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Chatter</h1>
          <p className="subtitle">Something went wrong loading the app.</p>
          <div className="error">{this.state.error.message}</div>
          <button onClick={() => window.location.reload()}>Try again</button>
          <button className="secondary" onClick={this.handleReset}>
            Log out and start over
          </button>
        </div>
      </div>
    );
  }
}
