import { createRoot } from 'react-dom/client'
import App from './App'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// Deliberately no <StrictMode>: its double-invoked effects would spawn two pi
// processes and two xterm instances per mount.
createRoot(container).render(<App />)
