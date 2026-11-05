import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHandBackState } from './handBack';

// The stack of buttons that opened the screens one level down: Back gives the focus to the one on top, but only
// to a button the screen that has just appeared actually holds.

function buttons(...names: string[]): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const name of names) {
    const node = document.createElement('button');
    node.textContent = name;
    document.body.append(node);
    out[name] = node;
  }
  return out;
}

describe('the hand-back of the focus', () => {
  it('gives the focus to the opener on top of the stack, once', () => {
    const { result } = renderHook(() => useHandBackState());
    const nodes = buttons('settings');
    result.current.register('settings', nodes.settings ?? null);
    result.current.expect('settings');
    act(() => { result.current.deliver(); });
    expect(nodes.settings).toHaveFocus();
    nodes.settings?.blur();
    act(() => { result.current.deliver(); });
    expect(nodes.settings).not.toHaveFocus();
  });

  it('keeps an opener for the screen that holds it: a screen without it takes nothing', () => {
    const { result } = renderHook(() => useHandBackState());
    const nodes = buttons('settings', 'extra');
    result.current.register('settings', nodes.settings ?? null);
    result.current.expect('settings');
    result.current.expect('extra');
    // The hub appears holding settings only: extra is on top and not here.
    act(() => { result.current.deliver(); });
    expect(nodes.settings).not.toHaveFocus();
    result.current.register('extra', nodes.extra ?? null);
    act(() => { result.current.deliver(); });
    expect(nodes.extra).toHaveFocus();
    nodes.extra?.blur();
    // And one level further up.
    act(() => { result.current.deliver(true); });
    expect(nodes.settings).toHaveFocus();
  });

  it('the root screen forgets whatever is left, and forget() clears everything', () => {
    const { result } = renderHook(() => useHandBackState());
    const nodes = buttons('a', 'b');
    result.current.register('a', nodes.a ?? null);
    result.current.expect('a');
    result.current.expect('gone');
    act(() => { result.current.deliver(true); });
    expect(nodes.a).not.toHaveFocus();
    result.current.register('b', nodes.b ?? null);
    result.current.expect('b');
    result.current.forget();
    act(() => { result.current.deliver(); });
    expect(nodes.b).not.toHaveFocus();
  });

  it('an opener that goes away is no longer there to take the focus', () => {
    const { result } = renderHook(() => useHandBackState());
    const nodes = buttons('x');
    result.current.register('x', nodes.x ?? null);
    result.current.register('x', null);
    result.current.expect('x');
    act(() => { result.current.deliver(); });
    expect(nodes.x).not.toHaveFocus();
  });

  it('replaceTop swaps the opener on top for another, leaving the ones under it', () => {
    const { result } = renderHook(() => useHandBackState());
    const nodes = buttons('door', 'row', 'title');
    for (const name of ['door', 'row', 'title']) result.current.register(name, nodes[name] ?? null);
    result.current.expect('door');
    result.current.expect('row');
    // The screen opened by «row» is left by a move of its own, landing where «title» is owed the focus.
    result.current.replaceTop('title');
    act(() => { result.current.deliver(); });
    expect(nodes.title).toHaveFocus();
    nodes.title?.blur();
    act(() => { result.current.deliver(true); });
    expect(nodes.door).toHaveFocus();
    expect(nodes.row).not.toHaveFocus();
  });
});
