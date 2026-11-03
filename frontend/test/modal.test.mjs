import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader } from './load-source.mjs';

function fixture() {
  const effects = [];
  const calls = [];
  class Element {
    isConnected = true;
    focus() { calls.push('focus-return'); }
  }
  const trigger = new Element();
  const element = {
    showModal() { calls.push('showModal'); },
    close() { calls.push('close'); },
  };
  const document = { activeElement: trigger, body: { style: { overflow: 'auto' } } };
  const { Modal } = sourceLoader({
    react: {
      useEffect(effect) { effects.push(effect); },
      useRef(initial) { return { current: initial === null ? element : initial }; },
    },
  }, { document, HTMLElement: Element })('src/components/ui/modal.tsx');
  let closes = 0;
  const view = Modal({ children: 'dialog content', labelledBy: 'title', onClose() { closes++; } });
  return { view, calls, document, trigger, mount: () => effects[0](), closes: () => closes };
}

test('Modal opens as a native modal, locks scrolling, then restores scrolling and trigger focus', () => {
  const state = fixture();
  assert.equal(state.view.type, 'dialog');
  assert.equal(state.view.props['aria-labelledby'], 'title');
  const unmount = state.mount();
  assert.deepEqual(state.calls, ['showModal']);
  assert.equal(state.document.body.style.overflow, 'hidden');
  unmount();
  assert.deepEqual(state.calls, ['showModal', 'close', 'focus-return']);
  assert.equal(state.document.body.style.overflow, 'auto');
});

test('Modal closes on an outside click, but not content clicks or drags starting inside', () => {
  const state = fixture();
  const dialog = {};
  const content = {};
  const inside = { target: content, currentTarget: dialog };
  const outside = { target: dialog, currentTarget: dialog };
  state.view.props.onPointerDown(inside);
  state.view.props.onClick(inside);
  state.view.props.onPointerDown(inside);
  state.view.props.onClick(outside);
  assert.equal(state.closes(), 0);
  state.view.props.onPointerDown(outside);
  state.view.props.onClick(outside);
  assert.equal(state.closes(), 1);
});

test('Modal handles Escape through native cancel and does not restore focus to a detached trigger', () => {
  const state = fixture();
  let prevented = false;
  const unmount = state.mount();
  state.view.props.onCancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(state.closes(), 1);
  state.trigger.isConnected = false;
  unmount();
  assert.deepEqual(state.calls, ['showModal', 'close']);
});
