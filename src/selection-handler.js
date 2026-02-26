// BF's Agentic Response Validator - Text Selection Handler
// Select text in AI messages -> floating button -> add/remove cliche patterns
// Works on both desktop (mouseup) and mobile (touchend)

import { getSettings, addCustomClichePattern, removeCustomClichePattern, hasCustomClichePattern } from './settings.js';
import { textToPattern } from './local-checker.js';

let floatingBtn = null;
let currentSelectedText = '';
let currentPattern = '';
let hideTimeout = null;

/**
 * Create the floating action button (once)
 */
function createFloatingButton() {
    if (floatingBtn) return;

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'bf_validator_selection_btn';
    floatingBtn.style.display = 'none';

    floatingBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick();
    });

    // Prevent button from stealing selection on touch
    floatingBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    floatingBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick();
    });

    document.body.appendChild(floatingBtn);
}

/**
 * Handle click on the floating button
 */
function handleButtonClick() {
    if (!currentPattern) return;

    const settings = getSettings();
    if (!settings) return;

    if (hasCustomClichePattern(currentPattern)) {
        // Remove existing pattern
        removeCustomClichePattern(currentPattern);
        toastr.info(`Pattern removed: "${currentSelectedText.substring(0, 40)}..."`, 'BF Validator');
    } else {
        // Add new pattern
        addCustomClichePattern(currentPattern);
        toastr.success(`Pattern added: "${currentSelectedText.substring(0, 40)}..."`, 'BF Validator');
    }

    hideFloatingButton();
    // Clear selection
    window.getSelection()?.removeAllRanges();
}

/**
 * Show the floating button near the selection
 * @param {string} text - Selected text
 * @param {DOMRect} rect - Bounding rect of selection
 */
function showFloatingButton(text, rect) {
    if (!floatingBtn) createFloatingButton();

    currentSelectedText = text;
    currentPattern = textToPattern(text);

    const isExisting = hasCustomClichePattern(currentPattern);

    floatingBtn.innerHTML = isExisting
        ? '<i class="fa-solid fa-minus"></i> Remove Cliche'
        : '<i class="fa-solid fa-plus"></i> Add Cliche';

    floatingBtn.classList.toggle('bf-selection-remove', isExisting);
    floatingBtn.classList.toggle('bf-selection-add', !isExisting);

    // Position above the selection
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    let top = rect.top + scrollTop - 40;
    let left = rect.left + scrollLeft;

    // Keep within viewport
    const btnWidth = 160; // approximate
    if (left + btnWidth > window.innerWidth + scrollLeft) {
        left = window.innerWidth + scrollLeft - btnWidth - 10;
    }
    if (left < scrollLeft + 5) {
        left = scrollLeft + 5;
    }
    if (top < scrollTop + 5) {
        top = rect.bottom + scrollTop + 5;
    }

    floatingBtn.style.top = `${top}px`;
    floatingBtn.style.left = `${left}px`;
    floatingBtn.style.display = 'flex';

    // Clear any pending hide
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
}

/**
 * Hide the floating button
 */
function hideFloatingButton() {
    if (floatingBtn) {
        floatingBtn.style.display = 'none';
    }
    currentSelectedText = '';
    currentPattern = '';
}

/**
 * Handle text selection events
 */
function handleSelection() {
    const settings = getSettings();
    if (!settings || !settings.enabled) {
        hideFloatingButton();
        return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
        // Delay hiding to allow button click
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hideFloatingButton, 200);
        return;
    }

    const text = selection.toString().trim();

    // Must have at least 3 characters to be a useful pattern
    if (text.length < 3) {
        hideFloatingButton();
        return;
    }

    // Check if selection is inside an AI message (.mes_text)
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const mesText = container.nodeType === Node.ELEMENT_NODE
        ? container.closest?.('.mes_text')
        : container.parentElement?.closest?.('.mes_text');

    if (!mesText) {
        hideFloatingButton();
        return;
    }

    // Make sure it's an AI message, not a user message
    const mesElement = mesText.closest('.mes');
    if (!mesElement || mesElement.getAttribute('is_user') === 'true') {
        hideFloatingButton();
        return;
    }

    // Show the floating button
    const rect = range.getBoundingClientRect();
    showFloatingButton(text, rect);
}

/**
 * Initialize the selection handler
 */
export function initSelectionHandler() {
    createFloatingButton();

    // Desktop: mouseup on chat container
    const chatContainer = document.getElementById('chat');
    if (chatContainer) {
        chatContainer.addEventListener('mouseup', () => {
            // Small delay to let selection finalize
            setTimeout(handleSelection, 50);
        });

        // Mobile: touchend
        chatContainer.addEventListener('touchend', () => {
            // Longer delay for mobile selection
            setTimeout(handleSelection, 300);
        });
    }

    // Hide button on click elsewhere
    document.addEventListener('mousedown', (e) => {
        if (floatingBtn && !floatingBtn.contains(e.target)) {
            // Don't hide immediately - let the selection handler check first
            if (hideTimeout) clearTimeout(hideTimeout);
            hideTimeout = setTimeout(hideFloatingButton, 150);
        }
    });

    // Hide on scroll
    document.addEventListener('scroll', () => {
        hideFloatingButton();
    }, true);

    console.log('[BFValidator] Selection handler initialized');
}
