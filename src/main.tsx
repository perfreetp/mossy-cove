import { render } from 'solid-js/web';
import App from './ui/App';
import { initPersistence } from './state/store';
import './styles.css';

initPersistence();
render(() => <App />, document.getElementById('root')!);
