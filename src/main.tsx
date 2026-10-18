import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
  state={error:''};
  static getDerivedStateFromError(error:Error){return {error:error.message};}
  render(){return this.state.error?<main className="recovery-screen"><h1>The garden needs a moment.</h1><p>Your saved progress has not been cleared.</p><pre>{this.state.error}</pre><button onClick={()=>location.reload()}>Reload saved garden</button></main>:this.props.children;}
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
