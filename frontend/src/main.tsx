import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { CheatCodeProvider } from './contexts/CheatCodeContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CheatCodeProvider>
        <App />
      </CheatCodeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)