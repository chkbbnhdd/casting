import { Injectable } from '@angular/core';

/**
 * Suppresses all CAF break-related UI elements from the Cast player shadow DOM.
 *
 * The CAF player renders its UI inside one or more nested shadow roots which
 * cannot be styled from the host page. This service injects a `<style>` element
 * into each shadow root and sets `display:none !important` on every break element
 * it finds. It recurses into nested shadow roots to catch all layers.
 *
 * Suppressed selectors include `.breakInfo`, `.breakOverlay`, `#castBreakMetadata`,
 * `[id*="Break"]`, `[class*="break"]`, etc.
 */
@Injectable({ providedIn: 'root' })
export class BreakUISuppressor {
  private readonly styleElementId = 'drtv-hide-break-ui-style';
  private readonly breakSelectors = [
    '.breakInfo',
    '.breakOverlay',
    '.breakMetadata',
    '#castBreakMetadata',
    '#castBreakSkippableTime',
    '#castSkipBreakMessage',
    '[id*="Break"]',
    '[id*="break"]',
    '[class*="break"]',
    '[class*="Break"]',
  ].join(',');

  /**
   * Hides all break UI elements within `shadowRoot` and any nested shadow roots.
   *
   * Safe to call repeatedly — the injected `<style>` element is only created once
   * per shadow root (identified by {@link styleElementId}).
   *
   * @param shadowRoot - The CAF player shadow root to suppress break UI within.
   */
  hideBreakUI(shadowRoot: ShadowRoot): void {
    this.ensureStyles(shadowRoot);
    this.hideElements(shadowRoot);
    this.recursivelyHideNestedShadowRoots(shadowRoot);
  }

  /**
   * Traverses all elements in `shadowRoot` and recursively calls
   * {@link hideBreakUI} on any nested shadow roots found.
   */
  private recursivelyHideNestedShadowRoots(shadowRoot: ShadowRoot): void {
    const descendants = shadowRoot.querySelectorAll<HTMLElement>('*');
    descendants.forEach((node) => {
      const nestedShadowRoot = node.shadowRoot;
      if (nestedShadowRoot) {
        this.hideBreakUI(nestedShadowRoot);
      }
    });
  }

  /**
   * Sets `display:none`, `visibility:hidden`, `opacity:0`, and
   * `pointer-events:none` on every element matching {@link breakSelectors}.
   */
  private hideElements(shadowRoot: ShadowRoot): void {
    const breakElements = shadowRoot.querySelectorAll<HTMLElement>(this.breakSelectors);
    breakElements.forEach((element) => {
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('opacity', '0', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
    });
  }

  /**
   * Lazily injects a `<style>` block into `shadowRoot` that hides all break
   * selectors via CSS. The element is keyed by {@link styleElementId} to avoid
   * duplicate injection across repeated calls.
   */
  private ensureStyles(shadowRoot: ShadowRoot): void {
    const existing = shadowRoot.getElementById(this.styleElementId);
    if (existing) {
      return;
    }

    const style = document.createElement('style');
    style.id = this.styleElementId;
    style.textContent = `
      .breakInfo,
      .breakOverlay,
      .breakMetadata,
      #castBreakMetadata,
      #castBreakSkippableTime,
      #castSkipBreakMessage,
      [id*="Break"],
      [id*="break"],
      [class*="break"],
      [class*="Break"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    shadowRoot.appendChild(style);
  }
}
