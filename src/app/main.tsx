import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './App'
import './styles.css'

// persisted theme (the html starts dark to avoid flash)
const theme = localStorage.getItem('revai-theme') || 'dark'
document.documentElement.dataset.theme = theme

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
