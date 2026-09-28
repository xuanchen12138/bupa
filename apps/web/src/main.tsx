import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import { queryClient } from './lib/query';
import { useLocale } from './i18n';
import './styles.css';

document.documentElement.lang = useLocale.getState().locale === 'zh' ? 'zh-CN' : 'en';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
