/**
 * Accessible post-interaction form validation & ARIA live-region sync
 * (modern-web-guidance: validate-input-after-interaction).
 * Also provides :user-invalid fallback when older engines lack native support,
 * and pointer-coordinate light-dismiss fallback for <dialog closedby="any">.
 */

const dirtyState = new WeakMap<Element, { hasInteracted: boolean; hasBlurred: boolean }>();
const flagged = new WeakSet<Element>();
const announced = new WeakSet<Element>();

export function initAccessibleFormValidation(root: Document = document): () => void {
  const supportsUserInvalid =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('selector(:user-invalid)');

  const announcer = root.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.classList.add('visually-hidden');
  root.body.append(announcer);

  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let announcedField: Element | null = null;

  const linkError = (el: HTMLElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const spokenText = (node: Element): string => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
      n.replaceWith(`${n.getAttribute('aria-label')}: `);
    });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const announceError = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const errorEl = root.getElementById(errorId);
    if (!errorEl) return;
    const firstLabel = el.labels?.[0];
    const label = firstLabel ? `${spokenText(firstLabel)}: ` : '';
    clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = label + spokenText(errorEl);
    }, 450);
  };

  const isFieldElement = (
    el: EventTarget | null
  ): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    el instanceof HTMLElement && el.matches('input, select, textarea');

  const syncAria = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, announce = false) => {
    const invalid = supportsUserInvalid
      ? el.matches(':user-invalid')
      : el.classList.contains('user-invalid-fallback');

    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  const updateFallbackState = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    const valid = el.validity.valid;
    el.classList.toggle('user-invalid-fallback', !valid);
    el.classList.toggle('user-valid-fallback', valid);
    syncAria(el, !valid);
  };

  root.querySelectorAll('input, select, textarea').forEach((el) => {
    if (isFieldElement(el)) {
      if (!el.hasAttribute('aria-invalid')) el.setAttribute('aria-invalid', 'false');
      syncAria(el);
    }
  });

  const onBlur = (e: Event) => {
    const el = e.target;
    if (!isFieldElement(el)) return;
    if (!supportsUserInvalid) {
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasBlurred = true;
      dirtyState.set(el, state);
      if (state.hasInteracted) updateFallbackState(el);
      return;
    }
    syncAria(el, true);
  };

  const onInput = (e: Event) => {
    const el = e.target;
    if (!isFieldElement(el)) return;
    if (!supportsUserInvalid) {
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(el, state);
      if (state.hasBlurred) updateFallbackState(el);
      return;
    }
    if (el.hasAttribute('aria-invalid')) syncAria(el);
  };

  const onChange = (e: Event) => {
    const el = e.target;
    if (!isFieldElement(el)) return;
    if (!supportsUserInvalid) {
      const state = dirtyState.get(el) || { hasInteracted: false, hasBlurred: false };
      state.hasInteracted = true;
      dirtyState.set(el, state);
      if (state.hasBlurred) updateFallbackState(el);
      return;
    }
    syncAria(el, true);
  };

  const onInvalid = (e: Event) => {
    const el = e.target;
    if (!isFieldElement(el)) return;
    announced.add(el);
    if (!supportsUserInvalid) {
      dirtyState.set(el, { hasInteracted: true, hasBlurred: true });
      updateFallbackState(el);
      return;
    }
    syncAria(el);
  };

  const onReset = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    setTimeout(() => {
      for (const control of Array.from(form.elements)) {
        if (!isFieldElement(control)) continue;
        dirtyState.delete(control);
        control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
        control.setAttribute('aria-invalid', 'false');
        linkError(control, false);
        flagged.delete(control);
        announced.delete(control);
      }
    });
  };

  root.addEventListener('blur', onBlur, true);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange, true);
  root.addEventListener('invalid', onInvalid, true);
  root.addEventListener('reset', onReset, true);

  return () => {
    clearTimeout(announceTimer);
    root.removeEventListener('blur', onBlur, true);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('invalid', onInvalid, true);
    root.removeEventListener('reset', onReset, true);
    announcer.remove();
  };
}

/**
 * Light-dismiss fallback for `<dialog closedby="any">` on Safari / engines lacking `closedBy`
 * (modern-web-guidance: dialog). Requires both pointerdown and pointerup outside dialog rect.
 */
export function attachDialogLightDismiss(dialog: HTMLDialogElement): () => void {
  if ('closedBy' in HTMLDialogElement.prototype) {
    return () => {};
  }
  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  const onDown = (e: PointerEvent) => {
    if (dialog.open) pressedOutside = isOutside(e);
  };
  const onUp = (e: PointerEvent) => {
    if (dialog.open && pressedOutside && isOutside(e)) {
      dialog.close();
    }
    pressedOutside = false;
  };
  dialog.addEventListener('pointerdown', onDown);
  dialog.addEventListener('pointerup', onUp);
  return () => {
    dialog.removeEventListener('pointerdown', onDown);
    dialog.removeEventListener('pointerup', onUp);
  };
}
