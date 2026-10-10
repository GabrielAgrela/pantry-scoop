import { t } from './i18n.js';

const button = document.getElementById('mobile-approve');
const open = document.getElementById('mobile-open');
const problem = document.getElementById('mobile-error');
button.addEventListener('click', async () => {
  button.disabled = true;
  problem.hidden = true;
  try {
    const response = await fetch('/api/auth/mobile/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Sign-in could not finish. Start again in Android.');
    open.href = data.url;
    open.hidden = false;
    button.hidden = true;
    open.focus();
  } catch (error) {
    problem.textContent = t(error.message);
    problem.hidden = false;
    button.disabled = false;
  }
});
