import { api } from './api.js';
import { h, MANAGE_USAGE_URL, openDialog } from './dom.js';
import { icon } from './ui.js';
import { recipeVoice } from './voice.js';
import { createAutomaticVoice } from './automatic-voice.js';
import { readable, t } from './i18n.js';

/** One conversation per open recipe, kept when Scoop's chat is tucked away. */
export function createRecipeCompanion(recipe) {
  const messages = [];
  let activeChat;
  const button = h('button', { type: 'button', class: 'recipe-scoop', 'aria-label': t('Ask Scoop about this recipe'), title: t('Ingredient swaps, tricky steps… ask Scoop!'), onclick: openChat },
    h('span', { class: 'recipe-scoop-float', 'aria-hidden': 'true' }, h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 64, height: 68 })),
    h('span', { class: 'recipe-scoop-label' }, t('Ask Scoop')));

  function openChat() {
    if (activeChat?.dialog.isConnected) return;
    const voice = recipeVoice();
    const lang = document.documentElement.lang || navigator.language || 'en';
    let canSpeak = false, canListen = false, sending = false, listening = false, closed = false;
    let recognition, voiceSequence = 0, recordingTimer, voiceSubmission = false;
    const heldReplies = new Set();
    const report = failure => {
      if (closed) return;
      error.textContent = failure.message; error.hidden = false;
    };
    const speech = createAutomaticVoice(voice, {
      allowed: () => !closed && !document.hidden,
      onError: report,
      onChange: refreshMute,
    });
    const mute = h('button', { type: 'button', class: 'icon recipe-chat-mute',
      onclick: () => speech.setMuted(!speech.muted) });
    function refreshMute() {
      const label = speech.muted ? t('Unmute Scoop') : t('Mute Scoop');
      mute.replaceChildren(icon(speech.muted ? 'muted' : 'speaker'));
      mute.setAttribute('aria-label', label); mute.title = label;
      mute.setAttribute('aria-pressed', String(speech.muted));
      if (speech.muted) [...heldReplies].forEach(reveal => reveal());
    }
    refreshMute();
    function stopSpeaking() { speech.cancel(); }
    const log = h('div', { class: 'recipe-chat-log', role: 'log', 'aria-label': t('Recipe conversation'), 'aria-live': 'polite', 'aria-relevant': 'additions text' });
    const addMessage = (role, content) => {
      const entry = h('div', { class: `recipe-chat-message ${role}` }, h('strong', {}, role === 'user' ? t('You') : 'Scoop'), h('p', {}, content));
      log.append(entry);
      log.scrollTop = log.scrollHeight;
      return entry;
    };
    addMessage('assistant', t('A little kitchen help? Ask me about a swap, a measurement or a tricky step.'));
    messages.forEach(({ role, content }) => addMessage(role, content));
    const input = h('textarea', { rows: 2, maxLength: 2000, placeholder: t('Can I replace…?'), 'aria-label': t('Your question about this recipe'), required: true });
    const send = h('button', { type: 'submit', class: 'primary', 'aria-label': t('Send recipe question') }, icon('arrow'));
    const error = h('p', { class: 'recipe-chat-error', role: 'alert', hidden: true });
    const voiceHint = h('span', { class: 'recipe-voice-hint', id: 'recipe-voice-status', role: 'status' });
    const mic = h('button', { type: 'button', class: 'recipe-voice-button', disabled: true,
      'aria-label': t('Talk to Scoop'), title: t('Talk to Scoop'), 'aria-describedby': 'recipe-voice-status',
      'aria-pressed': 'false', onclick: toggleListening }, icon('microphone'));
    function finishListening(hint = '') {
      listening = false; clearTimeout(recordingTimer);
      input.readOnly = false; send.disabled = sending; mic.disabled = sending || !canListen;
      mic.classList.remove('is-listening'); mic.setAttribute('aria-pressed', 'false'); mic.setAttribute('aria-label', t('Talk to Scoop'));
      mic.title = t('Talk to Scoop'); voiceHint.textContent = hint;
      prompts.querySelectorAll('button').forEach(prompt => { prompt.disabled = false; });
    }
    function cancelListening() {
      voiceSequence++; recognition?.cancel(); recognition = undefined; finishListening();
    }
    function toggleListening() {
      if (listening) {
        mic.disabled = true; voiceHint.textContent = t('Finishing your question…'); recognition?.stop(); return;
      }
      if (!canListen || sending || closed) return;
      stopSpeaking(); speech.prepare(); error.hidden = true;
      input.blur();
      const sequence = ++voiceSequence;
      const prefix = input.value.slice(0, input.selectionStart), suffix = input.value.slice(input.selectionEnd);
      const fillTranscript = text => {
        const spaceBefore = prefix && !/\s$/.test(prefix) ? ' ' : '';
        const spaceAfter = suffix && !/^\s/.test(suffix) ? ' ' : '';
        const room = Math.max(0, input.maxLength - prefix.length - suffix.length - spaceBefore.length - spaceAfter.length);
        const words = text.slice(0, room);
        input.value = words ? `${prefix}${spaceBefore}${words}${spaceAfter}${suffix}` : `${prefix}${suffix}`;
      };
      listening = true; input.readOnly = true; send.disabled = true;
      prompts.querySelectorAll('button').forEach(prompt => { prompt.disabled = true; });
      mic.setAttribute('aria-pressed', 'true'); mic.setAttribute('aria-label', t('Finish voice question'));
      mic.title = t('Finish voice question'); voiceHint.textContent = t('Opening microphone…');
      const current = () => sequence === voiceSequence && !closed;
      recordingTimer = setTimeout(() => {
        if (!current()) return;
        cancelListening(); voiceHint.textContent = t('Recording timed out · tap to try again');
      }, 45000);
      recognition = voice.listen({ lang,
        onStart: () => {
          if (!current()) return;
          mic.classList.add('is-listening'); voiceHint.textContent = t('Listening… stop speaking or tap the microphone to send');
        },
        onResult: text => {
          if (!current()) return;
          fillTranscript(text);
        },
        onError: failure => { if (current()) report(failure); },
        onEnd: result => {
          if (!current()) return;
          finishListening();
          // Send only completed speech. Silence, failed recognition and cancellations must never send typed text.
          if (result?.transcript?.trim() && !result.failed) {
            fillTranscript(result.transcript);
            voiceSubmission = true;
            try { form.requestSubmit(); }
            finally { voiceSubmission = false; }
            return;
          }
        },
      });
    }
    const prompts = h('div', { class: 'recipe-chat-prompts', 'aria-label': t('Question starters'), hidden: messages.length > 0 },
      ...[
        [t('Swap an ingredient'), t('Can I replace {ingredient} with ', { ingredient: readable(recipe).ingredients[0]?.name || t('an ingredient') })],
        [t('Explain a step'), t('Can you explain step ')],
        [t('Change the portions'), t('How do I adjust this recipe for ')],
      ].map(([label, start]) => h('button', { type: 'button', onclick: () => {
        input.value = start;
        input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      } }, label)));
    async function submit(event) {
      event.preventDefault();
      const fromVoice = voiceSubmission;
      voiceSubmission = false;
      const question = input.value.trim();
      if (!question || sending || listening) return;
      cancelListening(); stopSpeaking(); speech.prepare();
      sending = true; send.disabled = input.disabled = button.disabled = mic.disabled = true; error.hidden = true; prompts.hidden = true;
      const userEntry = addMessage('user', question);
      const pending = h('div', { class: 'recipe-chat-thinking', role: 'status' },
        h('img', { src: '/assets/scoop-guide.svg', alt: '', width: 36, height: 38 }),
        h('span', {}, t('Scoop is thinking')), h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
      log.append(pending); log.scrollTop = log.scrollHeight;
      chat.dialog.classList.add('is-thinking');
      try {
        const { answer } = await api.askRecipe(recipe, question, messages.slice(-20));
        await capabilitiesReady;
        messages.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
        input.value = ''; voiceHint.textContent = '';
        const reveal = () => {
          if (!heldReplies.delete(reveal)) return;
          pending.remove();
          if (!closed) addMessage('assistant', answer);
        };
        heldReplies.add(reveal);
        if (canSpeak) {
          if (!speech.muted) pending.querySelector('span').textContent = t('Scoop is getting ready to speak');
          const status = await speech.speak(answer, lang);
          if (status === 'started' || status === 'muted') reveal();
          else if (!closed) pending.replaceChildren(t('Voice isn’t playing. Mute Scoop to see the reply.'));
        } else reveal();
      } catch (failure) {
        userEntry.remove(); pending.remove();
        error.replaceChildren(failure.message,
          failure.code === 'usage-limit' ? h('a', { href: failure.manageUsageUrl ?? MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, t('Manage usage')) : '');
        error.hidden = false;
      } finally {
        sending = false; send.disabled = input.disabled = button.disabled = false;
        mic.disabled = !canListen;
        chat.dialog.classList.remove('is-thinking');
        if (!fromVoice && chat.dialog.isConnected && chat.dialog.open && !chat.dialog.inert) input.focus({ preventScroll: true });
      }
    }
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    const form = h('form', { class: 'recipe-chat-form', onsubmit: submit }, error,
      h('div', { class: 'recipe-chat-compose' }, input, h('div', { class: 'recipe-chat-actions' }, mic, send)), voiceHint);
    const chat = openDialog('recipe-chat',
      h('header', { class: 'recipe-chat-header' },
        h('img', { class: 'recipe-chat-face', src: '/assets/scoop-guide.svg', alt: '', width: 64, height: 68 }),
        h('div', {}, h('h4', {}, t('Ask Scoop')), h('p', {}, readable(recipe).title)),
        mute, h('button', { type: 'button', class: 'icon', 'aria-label': t('Back to recipe'), onclick: () => { cleanup(); chat.close(); } }, icon('close'))),
      log, prompts, form);
    chat.dialog.setAttribute('aria-label', t('Ask Scoop about {title}', { title: readable(recipe).title }));
    activeChat = chat;
    function cleanup() {
      if (closed) return;
      closed = true; cancelListening(); stopSpeaking();
      heldReplies.clear();
      speech.dispose();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', cleanup);
    }
    function hidden() { if (document.hidden) { cancelListening(); speech.release(); } }
    chat.dialog.addEventListener('close', cleanup);
    chat.dialog.addEventListener('cancel', cleanup);
    chat.dialog.addEventListener('click', event => { if (event.target === chat.dialog) cleanup(); });
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', cleanup);
    const capabilitiesReady = voice.capabilities().then(capabilities => {
      if (closed) return;
      canListen = capabilities.listening; canSpeak = capabilities.speaking;
      mic.disabled = !canListen || sending;
      mic.title = canListen ? t('Talk to Scoop') : t('Voice input isn’t available on this device');
    }).catch(failure => { if (!closed) { voiceHint.textContent = t('Voice input isn’t available on this device'); report(failure); } });
    log.scrollTop = log.scrollHeight;
  }
  return button;
}
