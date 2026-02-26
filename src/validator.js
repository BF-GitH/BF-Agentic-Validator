// BF's Agentic Response Validator - Core Validation Module
// 2-Stage validation: Local Quick-Check -> Quality LLM
// Uses generateQuietPrompt (no /genraw), display:none (no CSS overlay)

import { getSettings, updateStatus, addDebugLog } from './settings.js';

/** @returns {object} SillyTavern context */
function getContext() {
    return SillyTavern.getContext();
}
import { runWithOptionalProfile } from './profiler.js';
import { buildFeedbackOOC, injectIntoLastUserMessage } from './injector.js';
import { runLocalChecks } from './local-checker.js';

// State management
let isValidating = false;
let currentAttempt = 0;
let pendingMessageIndex = null;
let interceptActive = false;
let validationInProgress = false;
let isRetrying = false;

// Pending OOC for next regeneration
let pendingOOCInjection = null;

// Reveal button reference
let revealBtnElement = null;

// MutationObserver to pre-hide AI messages before streaming
let messageObserver = null;
let observerTimeout = null;

// Safety timeout for the checking indicator
let indicatorSafetyTimeout = null;

// Delayed cleanup timeout for GENERATION_STOPPED
let generationCleanupTimeout = null;

/**
 * Hide a message completely (display:none) while validating
 * @param {number} messageIndex - Index of message to hide
 */
function hideMessage(messageIndex) {
    const messageElement = document.querySelector(`[mesid="${messageIndex}"]`);
    if (messageElement) {
        messageElement.dataset.bfValidating = 'true';
        messageElement.style.display = 'none';
        addDebugLog('info', `Message ${messageIndex} hidden for validation`);
    }
    showCheckingIndicator();
    showRevealButton();
}

/**
 * Show a previously hidden message
 * @param {number} messageIndex - Index of message to show
 */
function showMessage(messageIndex) {
    const messageElement = document.querySelector(`[mesid="${messageIndex}"]`);
    if (messageElement) {
        messageElement.style.display = '';
        delete messageElement.dataset.bfValidating;
        messageElement.dataset.bfValidated = 'true';
        addDebugLog('info', `Message ${messageIndex} revealed`);
    }
    hideCheckingIndicator();
    hideRevealButton();
}

/**
 * Force reveal a message (skip validation) - called from burger menu
 * @param {number} messageIndex - Index of message
 */
function forceRevealMessage(messageIndex) {
    if (messageIndex === null || messageIndex === undefined) return;

    const messageElement = document.querySelector(`[mesid="${messageIndex}"]`);
    if (messageElement) {
        messageElement.style.display = '';
        delete messageElement.dataset.bfValidating;
        messageElement.dataset.bfValidated = 'true';
    }

    hideCheckingIndicator();
    hideRevealButton();

    // Reset validation state
    isValidating = false;
    validationInProgress = false;
    interceptActive = false;
    isRetrying = false;
    updateStatus('idle', 'Message force-revealed by user');
    addDebugLog('info', `Message ${messageIndex} force-revealed by user`);
}

/**
 * Show the "Checking response..." indicator banner
 */
function showCheckingIndicator() {
    let indicator = document.getElementById('bf_validator_checking_indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'bf_validator_checking_indicator';
        indicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validating response...';

        // Insert before the chat input area
        const sendForm = document.getElementById('send_form');
        if (sendForm) {
            sendForm.parentNode.insertBefore(indicator, sendForm);
        }
    }
    indicator.style.display = 'flex';

    // Safety timeout: auto-hide indicator after 120s if validation hasn't completed
    if (indicatorSafetyTimeout) {
        clearTimeout(indicatorSafetyTimeout);
    }
    indicatorSafetyTimeout = setTimeout(() => {
        addDebugLog('fail', 'Indicator safety timeout (120s) - forcing cleanup');
        resetState();
    }, 120000);
}

/**
 * Hide the checking indicator
 */
function hideCheckingIndicator() {
    if (indicatorSafetyTimeout) {
        clearTimeout(indicatorSafetyTimeout);
        indicatorSafetyTimeout = null;
    }
    const indicator = document.getElementById('bf_validator_checking_indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

/**
 * Add "Reveal Response" button to the burger menu
 */
function initRevealButton() {
    const menuList = document.querySelector('#chat_options .list-group');
    if (!menuList) {
        // Retry after a short delay (menu may not be loaded yet)
        setTimeout(initRevealButton, 1000);
        return;
    }

    // Don't add if already exists
    if (document.getElementById('bf_validator_reveal_btn')) return;

    const menuItem = document.createElement('a');
    menuItem.id = 'bf_validator_reveal_btn';
    menuItem.className = 'list-group-item';
    menuItem.innerHTML = '<i class="fa-solid fa-eye"></i> Reveal Response';
    menuItem.style.display = 'none';
    menuItem.style.cursor = 'pointer';
    menuItem.addEventListener('click', () => {
        forceRevealMessage(pendingMessageIndex);
        // Close the burger menu
        document.getElementById('chat_options')?.classList.remove('openDrawer');
    });

    menuList.appendChild(menuItem);
    revealBtnElement = menuItem;
}

/**
 * Show the reveal button in burger menu
 */
function showRevealButton() {
    if (revealBtnElement) {
        revealBtnElement.style.display = '';
    }
}

/**
 * Hide the reveal button in burger menu
 */
function hideRevealButton() {
    if (revealBtnElement) {
        revealBtnElement.style.display = 'none';
    }
}

/**
 * Start observing #chat for new AI message elements and hide them instantly.
 * This prevents the user from seeing the response text before validation completes.
 */
function startPreHideObserver() {
    stopPreHideObserver();

    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    messageObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.classList?.contains('mes') && node.getAttribute('is_user') !== 'true') {
                    node.dataset.bfValidating = 'true';
                    node.style.display = 'none';
                    addDebugLog('info', 'Pre-hidden AI message before streaming');
                    showCheckingIndicator();
                    showRevealButton();
                    stopPreHideObserver();
                    return;
                }
            }
        }
    });

    messageObserver.observe(chatEl, { childList: true });

    // Safety: disconnect after 60 seconds if nothing happened
    observerTimeout = setTimeout(() => stopPreHideObserver(), 60000);
}

/**
 * Stop the pre-hide MutationObserver
 */
function stopPreHideObserver() {
    if (messageObserver) {
        messageObserver.disconnect();
        messageObserver = null;
    }
    if (observerTimeout) {
        clearTimeout(observerTimeout);
        observerTimeout = null;
    }
}

/**
 * Get recent messages from chat for context
 * @param {number} count - Number of messages to get
 * @param {string} filter - 'user' for user messages only, 'all' for all messages
 * @returns {string} Formatted context string
 */
function getRecentMessages(count, filter = 'all') {
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return '';

    const messages = [];
    // Walk backwards from chat, skip the LAST message (that's the reply being validated)
    const startIndex = chat.length - 2;
    for (let i = startIndex; i >= 0 && messages.length < count; i--) {
        const msg = chat[i];
        if (!msg || !msg.mes) continue;

        if (filter === 'user' && msg.is_user) {
            messages.unshift(`USER: ${msg.mes.substring(0, 500)}`);
        } else if (filter === 'all') {
            const role = msg.is_user ? 'USER' : 'AI';
            messages.unshift(`${role}: ${msg.mes.substring(0, 500)}`);
        }
    }

    return messages.join('\n\n');
}

/**
 * Run LLM validation via generateQuietPrompt
 * @param {string} prompt - The validation prompt
 * @returns {Promise<string>} LLM response text
 */
async function runLLMCheck(prompt) {
    const context = SillyTavern.getContext();

    // Set flag to prevent GENERATION_STARTED from re-arming
    validationInProgress = true;

    try {
        // Add timeout wrapper (60 seconds)
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Validation request timed out after 60s')), 60000);
        });

        const genPromise = context.generateQuietPrompt({ quietPrompt: prompt, skipWIAN: true });
        const result = await Promise.race([genPromise, timeoutPromise]);
        const resultStr = typeof result === 'string' ? result : String(result || '');

        if (!resultStr.trim()) {
            addDebugLog('fail', `Validator LLM returned empty! (type: ${typeof result}, value: ${JSON.stringify(result)})`);
        }

        return resultStr;
    } catch (err) {
        addDebugLog('fail', `Validator LLM error: ${err.message}`);
        // Return null to distinguish API errors from empty responses
        return null;
    } finally {
        validationInProgress = false;
    }
}

/**
 * Parse validation result from LLM response
 * Handles both new format {"pass": false, "failed": [1,3]} and legacy {"pass": false, "reason": "..."}
 * @param {string} response - Raw LLM response
 * @returns {{pass: boolean, reason: string, failed: number[]}}
 */
function parseValidationResult(response) {
    const cleaned = response.trim();

    // Empty response = LLM returned nothing, default to pass but log it
    if (!cleaned) {
        return { pass: true, reason: 'Empty result from validator LLM', failed: [] };
    }

    // Check for "pass" (case-insensitive, allow surrounding text like "pass." or "All pass")
    if (/\bpass\b/i.test(cleaned)) {
        return { pass: true, reason: '', failed: [] };
    }

    // Extract rule numbers (1-99 only, ignore large numbers)
    // Works even if the LLM was verbose — we just pull the numbers out
    const numbers = cleaned.match(/\d+/g);
    if (numbers && numbers.length > 0) {
        const failed = numbers.map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= 99);
        if (failed.length > 0) {
            // Deduplicate
            const unique = [...new Set(failed)];
            if (cleaned.length > 100) {
                addDebugLog('info', `Verbose reply (${cleaned.length} chars) but extracted rule numbers: ${unique.join(', ')}`);
            }
            return { pass: false, reason: `Failed rules: ${unique.join(', ')}`, failed: unique };
        }
    }

    // Fallback: try JSON format for backwards compatibility
    try {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof parsed.pass === 'boolean') {
                return {
                    pass: parsed.pass,
                    reason: parsed.reason || '',
                    failed: Array.isArray(parsed.failed) ? parsed.failed : [],
                };
            }
        }
    } catch (e) {
        // Not JSON, that's fine
    }

    // Long response with no extractable numbers or JSON = actual garbage
    if (cleaned.length > 500) {
        addDebugLog('fail', `Validator returned garbage (${cleaned.length} chars, no rule numbers found). Defaulting to pass.`);
        return { pass: true, reason: 'Validator LLM returned garbage — check your model', failed: [] };
    }

    // Default to pass to avoid blocking on unclear responses
    addDebugLog('info', `Validator reply unclear: "${cleaned.substring(0, 80)}" — defaulting to pass`);
    return { pass: true, reason: 'Parse unclear - defaulting to pass', failed: [] };
}

/**
 * Build numbered rules text from enabled rules array
 * @param {Array} rules - Array of rule objects
 * @returns {{rulesText: string, enabledRules: Array<{index: number, rule: object}>}}
 */
function buildNumberedRules(rules) {
    const enabledRules = [];
    let rulesText = '';
    let ruleNum = 1;

    for (const rule of rules) {
        if (!rule.enabled || !rule.check?.trim()) continue;
        enabledRules.push({ index: ruleNum, rule });
        rulesText += `Rule ${ruleNum} (${rule.name}): ${rule.check}\n`;
        ruleNum++;
    }

    return { rulesText: rulesText.trim(), enabledRules };
}

/**
 * Run Stage 1: Quality Check (LLM)
 * @param {string} response - AI response
 * @param {object} qualitySettings - qualityCheck settings
 * @returns {Promise<{pass: boolean, reason: string, failed: number[], enabledRules: Array}>}
 */
async function runQualityCheck(response, qualitySettings) {
    if (!qualitySettings.enabled) return { pass: true, reason: '', failed: [], enabledRules: [] };

    const rules = qualitySettings.rules || [];
    const { rulesText, enabledRules } = buildNumberedRules(rules);

    if (!rulesText) return { pass: true, reason: 'No quality rules configured', failed: [], enabledRules: [] };

    const recentMessages = getRecentMessages(qualitySettings.contextMessages, 'all');

    const prompt = qualitySettings.prompt
        .replace('{rules}', rulesText.substring(0, 2000))
        .replace('{recentMessages}', recentMessages.substring(0, 2000))
        .replace('{response}', response.substring(0, 2000));

    addDebugLog('info', `Stage 1: Checking ${enabledRules.length} rules — ${enabledRules.map(r => r.rule.name).join(', ')}`);
    addDebugLog('info', `── FULL PROMPT SENT TO VALIDATOR ──\n${prompt}`);

    let result = await runLLMCheck(prompt);

    // null = API error (not just empty) — retry once then surface the error
    if (result === null) {
        addDebugLog('info', 'Validator API error — retrying once...');
        result = await runLLMCheck(prompt);
    }

    // Still null after retry = persistent API error
    if (result === null) {
        addDebugLog('fail', 'Validator API error on both attempts — check your model/API settings');
        toastr.error('Validator LLM returned an API error (Bad Request). Quality check skipped — check your model settings.', 'BF Validator', { timeOut: 8000 });
        return { pass: true, reason: 'API error — validation skipped', failed: [], enabledRules, error: true };
    }

    // Empty string (not error) — retry once for transient hiccup
    if (!result.trim()) {
        addDebugLog('info', 'Validator returned empty — retrying once...');
        result = await runLLMCheck(prompt);
        if (result === null) {
            addDebugLog('fail', 'Validator API error on retry');
            toastr.error('Validator LLM error. Quality check skipped.', 'BF Validator', { timeOut: 8000 });
            return { pass: true, reason: 'API error — validation skipped', failed: [], enabledRules, error: true };
        }
    }

    addDebugLog('info', `Stage 1 validator reply: "${(result || '').trim() || '(empty)'}"`);

    const parsed = parseValidationResult(result || '');
    parsed.enabledRules = enabledRules;
    return parsed;
}

/**
 * Delete the current failed response and trigger retry with OOC feedback
 * @param {string} oocFeedback - OOC to inject before retry
 */
async function retryWithFeedback(oocFeedback) {
    const context = getContext();
    const runner = context.executeSlashCommandsWithOptions;

    // Store OOC for the prompt interceptor
    pendingOOCInjection = oocFeedback;

    // Delete the failed response
    addDebugLog('info', 'Deleting failed response...');
    await runner('/del 1');

    // Small delay to let UI update
    await new Promise(resolve => setTimeout(resolve, 500));

    // Regenerate - OOC will be injected via CHAT_COMPLETION_PROMPT_READY
    addDebugLog('info', 'Triggering regeneration with feedback...');
    isValidating = false;
    isRetrying = true;

    await runner('/trigger');
}

/**
 * Main validation function - 3-stage pipeline
 * @param {string} response - The AI response to validate
 * @param {number} messageIndex - Index of the message in chat
 */
async function validateResponse(response, messageIndex) {
    const settings = getSettings();

    isValidating = true;
    currentAttempt++;
    updateStatus('validating', `Validating (attempt ${currentAttempt}/${settings.maxRetries})`);

    if (currentAttempt === 1) {
        const profileInfo = settings.useValidatorProfile && settings.validatorProfile
            ? `WARNING: Using separate validator profile (${settings.validatorProfile})`
            : 'Using main model';
        addDebugLog('info', `Model: ${profileInfo}`);
    }
    addDebugLog('info', `AI response: ${response.substring(0, 500)}`);

    try {
        // ====== STAGE 0: Local Quick-Check (free, instant) ======
        if (settings.localCheck.enabled) {
            addDebugLog('info', 'Stage 0: Running local checks...');
            const localResult = runLocalChecks(response, settings.localCheck);

            if (!localResult.pass) {
                // Build dynamic feedback - one OOC per issue type using its own template
                const firstIssue = localResult.issues[0];
                addDebugLog('fail', `Stage 0 FAIL: ${localResult.issues.map(i => i.message).join('; ')}`);

                if (currentAttempt >= settings.maxRetries) {
                    addDebugLog('fail', `Max retries (${settings.maxRetries}) reached at Stage 0`);
                    showMessage(messageIndex);
                    finishValidation(false);
                    return;
                }

                // Use the template matching the first issue type
                const ooc = buildFeedbackOOC(firstIssue.type, {
                    reason: firstIssue.message,
                    attempt: currentAttempt + 1,
                    maxAttempts: settings.maxRetries,
                    max: settings.localCheck.maxWords || 0,
                    min: settings.localCheck.minWords || 0,
                    template: settings.localCheck.feedbackTemplates?.[firstIssue.type] || null,
                });

                addDebugLog('info', `OOC injected: ${ooc.substring(0, 500)}`);
                updateStatus('validating', `Stage 0 fail - retrying (${currentAttempt + 1}/${settings.maxRetries})`);
                if (settings.showToast) {
                    toastr.warning(`Local check failed: ${firstIssue.message}`, 'BF Validator');
                }

                await retryWithFeedback(ooc);
                return;
            }

            addDebugLog('pass', 'Stage 0 PASSED');
        }

        // ====== STAGE 1: LLM Quality Check (with optional profile switching) ======
        const llmResult = await runWithOptionalProfile(async () => {
            if (settings.qualityCheck.enabled) {
                addDebugLog('info', 'Stage 1: Running quality check...');
                const qualityResult = await runQualityCheck(response, settings.qualityCheck);

                if (!qualityResult.pass) {
                    const failedNames = qualityResult.failed
                        .map(num => qualityResult.enabledRules?.find(r => r.index === num)?.rule?.name)
                        .filter(Boolean);
                    const failInfo = failedNames.length > 0 ? `rules: ${failedNames.join(', ')}` : qualityResult.reason;
                    addDebugLog('fail', `Stage 1 FAIL: ${failInfo}`);
                    return { pass: false, reason: qualityResult.reason, failed: qualityResult.failed, enabledRules: qualityResult.enabledRules };
                }

                addDebugLog('pass', 'Stage 1 PASSED');
            }

            return { pass: true };
        }, settings);

        // Profile is now restored - handle LLM result
        if (llmResult && !llmResult.pass) {
            if (currentAttempt >= settings.maxRetries) {
                addDebugLog('fail', `Max retries (${settings.maxRetries}) reached at Stage 1`);
                showMessage(messageIndex);
                finishValidation(false);
                if (settings.showToast) {
                    toastr.warning(`Validation failed after ${settings.maxRetries} attempts`, 'BF Validator');
                }
                return;
            }

            // Build OOC from failed rules only
            const enabledRules = llmResult.enabledRules || [];
            const failedIndices = llmResult.failed || [];
            let combinedOoc = '';

            if (failedIndices.length > 0 && enabledRules.length > 0) {
                // Map failed rule numbers to their OOC instructions
                const failedOocs = failedIndices
                    .map(num => enabledRules.find(r => r.index === num))
                    .filter(r => r && r.rule.ooc?.trim())
                    .map(r => r.rule.ooc.trim());

                if (failedOocs.length > 0) {
                    combinedOoc = failedOocs.join(' ');
                    addDebugLog('info', `Failed rules: [${failedIndices.join(', ')}] - combining ${failedOocs.length} OOC instructions`);
                }
            }

            // Build the OOC injection
            const ooc = combinedOoc
                ? buildFeedbackOOC('quality', { template: `[OOC Instruction: ${combinedOoc}]` })
                : buildFeedbackOOC('quality', {
                    reason: llmResult.reason,
                    attempt: currentAttempt + 1,
                    maxAttempts: settings.maxRetries,
                    template: settings.qualityCheck.feedbackTemplate || null,
                });

            addDebugLog('info', `OOC injected: ${ooc.substring(0, 500)}`);
            updateStatus('validating', `Quality fail - retrying (${currentAttempt + 1}/${settings.maxRetries})`);
            if (settings.showToast) {
                const failedNames = failedIndices
                    .map(num => enabledRules.find(r => r.index === num)?.rule?.name)
                    .filter(Boolean);
                const failMsg = failedNames.length > 0 ? `Failed: ${failedNames.join(', ')}` : llmResult.reason;
                toastr.warning(failMsg, 'BF Validator');
            }

            await retryWithFeedback(ooc);
            return;
        }

        // ====== ALL STAGES PASSED ======
        addDebugLog('pass', `All stages passed on attempt ${currentAttempt}`);
        showMessage(messageIndex);
        finishValidation(true);

        if (settings.showToast) {
            toastr.success(`Response validated (attempt ${currentAttempt})`, 'BF Validator');
        }

    } catch (error) {
        console.error('[BFValidator] Validation error:', error);
        addDebugLog('fail', `Error: ${error.message}`);
        updateStatus('error', `Error: ${error.message}`);

        // Show message on error (don't block user)
        showMessage(messageIndex);
        finishValidation(false);
    }
}

/**
 * Clean up validation state
 * @param {boolean} passed - Whether validation passed
 */
function finishValidation(passed) {
    isValidating = false;
    validationInProgress = false;
    interceptActive = false;
    isRetrying = false;

    // Explicit cleanup as safety net
    hideCheckingIndicator();
    hideRevealButton();
    stopPreHideObserver();

    if (passed) {
        updateStatus('idle', `Last validation: PASSED (attempt ${currentAttempt})`);
    } else {
        updateStatus('idle', `Last validation: FAILED (after ${currentAttempt} attempts)`);
    }
}

/**
 * Reset validator state
 */
function resetState() {
    // Cancel any pending generation cleanup
    if (generationCleanupTimeout) {
        clearTimeout(generationCleanupTimeout);
        generationCleanupTimeout = null;
    }

    // Reveal any pending hidden message
    if (pendingMessageIndex !== null) {
        showMessage(pendingMessageIndex);
    }

    isValidating = false;
    validationInProgress = false;
    isRetrying = false;
    currentAttempt = 0;
    pendingMessageIndex = null;
    interceptActive = false;
    pendingOOCInjection = null;
    stopPreHideObserver();
    updateStatus('idle');
    hideCheckingIndicator();
    hideRevealButton();
}

/**
 * Initialize prompt interceptor for OOC injection
 */
function initPromptInterceptor() {
    const context = getContext();
    const { eventSource, eventTypes } = context;

    // Intercept prompt before sending to inject OOC feedback
    eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, (data) => {
        if (!pendingOOCInjection) return;

        // Skip dry runs (token counting) — don't inject and don't clear the pending OOC
        if (data && data.dryRun) return;

        // Skip our own validation LLM calls
        if (validationInProgress) return;

        const settings = getSettings();
        if (!settings || !settings.enabled) return;

        addDebugLog('info', 'Injecting OOC into prompt...');

        let success = false;

        if (data && data.chat && Array.isArray(data.chat)) {
            success = injectIntoLastUserMessage(data.chat, pendingOOCInjection, 'append');
        }

        if (!success && data && data.messages && Array.isArray(data.messages)) {
            success = injectIntoLastUserMessage(data.messages, pendingOOCInjection, 'append');
        }

        if (success) {
            addDebugLog('pass', 'OOC injected successfully');
            addDebugLog('info', `OOC content: ${pendingOOCInjection.substring(0, 300)}`);
        } else {
            addDebugLog('fail', 'Failed to inject OOC into prompt');
        }

        // Clear pending OOC only on successful injection
        // If generation is aborted and retried, the OOC will be re-injected
        if (success) {
            pendingOOCInjection = null;
        }
    });

    // Also handle text completion APIs
    eventSource.on(eventTypes.GENERATE_AFTER_DATA, (data, dryRun) => {
        if (!pendingOOCInjection || dryRun) return;

        const settings = getSettings();
        if (!settings || !settings.enabled) return;

        if (data && typeof data.prompt === 'string') {
            data.prompt = data.prompt + '\n\n' + pendingOOCInjection;
            addDebugLog('pass', 'Feedback OOC injected into text prompt');
            pendingOOCInjection = null;
        }
        // Don't clear pendingOOCInjection here if prompt was undefined -
        // CHAT_COMPLETION_PROMPT_READY still needs it for chat completion APIs
    });
}

/**
 * Test validation with a simple prompt (for debug panel)
 */
export async function testValidation() {
    addDebugLog('info', 'Starting validation test...');

    const settings = getSettings();

    try {
        // Test generateQuietPrompt
        addDebugLog('info', 'Testing generateQuietPrompt...');

        const testFn = async () => {
            const context = SillyTavern.getContext();
            const result = await context.generateQuietPrompt({ quietPrompt: 'Reply with: {"test": true}', skipWIAN: true });
            return result;
        };

        const result = await runWithOptionalProfile(testFn, settings);
        addDebugLog('info', `Test result: ${String(result).substring(0, 100)}`);

        if (result) {
            addDebugLog('pass', 'Test passed - generateQuietPrompt works!');
            toastr.success('Validation test passed!', 'BF Validator');
        } else {
            addDebugLog('fail', 'Test failed - empty result');
            toastr.warning('Test returned empty result', 'BF Validator');
        }
    } catch (err) {
        addDebugLog('fail', `Test error: ${err.message}`);
        console.error('[BFValidator] Test error:', err);
        toastr.error(`Test failed: ${err.message}`, 'BF Validator');
    }
}

/**
 * Initialize the validator system
 */
export function initValidator() {
    const context = getContext();

    if (!context || !context.eventSource || !context.eventTypes) {
        console.error('[BFValidator] Failed to get SillyTavern context');
        return;
    }

    const { eventSource, eventTypes } = context;

    // Clean up any stale state from previous load
    stopPreHideObserver();
    document.querySelectorAll('.mes[data-bf-validating="true"]').forEach(el => {
        el.style.display = '';
        delete el.dataset.bfValidating;
    });
    hideCheckingIndicator();

    // Initialize reveal button in burger menu
    initRevealButton();

    // On generation start - pre-hide message and prepare for interception
    eventSource.on(eventTypes.GENERATION_STARTED, () => {
        const settings = getSettings();
        if (!settings || !settings.enabled) return;

        // Don't interfere with our own LLM calls
        if (isValidating || validationInProgress) {
            addDebugLog('info', 'Generation started during validation - ignoring');
            return;
        }

        // Only reset attempt counter if this is NOT a retry
        if (!isRetrying) {
            currentAttempt = 0;
            addDebugLog('info', 'Fresh generation - attempt counter reset');
        } else {
            addDebugLog('info', `Retry generation - keeping attempt count at ${currentAttempt}`);
        }

        interceptActive = true;

        // Pre-hide: observe for new AI message and hide it before streaming starts
        startPreHideObserver();
        addDebugLog('info', 'Generation started - pre-hiding active');
    });

    // Intercept response after generation
    eventSource.on(eventTypes.MESSAGE_RECEIVED, async (messageIndex) => {
        // Cancel any pending generation-stopped cleanup since we got a real message
        if (generationCleanupTimeout) {
            clearTimeout(generationCleanupTimeout);
            generationCleanupTimeout = null;
        }

        // OOC has been delivered — clear it so it doesn't re-inject on next generation
        pendingOOCInjection = null;

        const settings = getSettings();
        if (!settings || !settings.enabled) return;
        if (!interceptActive) return;

        // Prevent re-entry
        if (isValidating) {
            addDebugLog('info', 'Already validating, skipping intercept');
            return;
        }

        const chat = context.chat;
        if (!chat || !chat[messageIndex]) {
            addDebugLog('fail', 'No message at index ' + messageIndex);
            return;
        }

        const response = chat[messageIndex].mes;
        pendingMessageIndex = messageIndex;

        addDebugLog('info', `Response received (${response.length} chars), hiding and validating...`);

        // Hide the message with display:none (100% reliable, mobile-compatible)
        hideMessage(messageIndex);

        // Start validation
        try {
            await validateResponse(response, messageIndex);
        } catch (err) {
            console.error('[BFValidator] validateResponse error:', err);
            addDebugLog('fail', `Validation error: ${err.message}`);
            showMessage(messageIndex);
            finishValidation(false);
        }
    });

    // Clean up when generation is stopped/aborted by the user.
    // Delay cleanup by 3s so MESSAGE_RECEIVED has time to fire first
    // (GENERATION_STOPPED fires *before* MESSAGE_RECEIVED during normal completion).
    eventSource.on(eventTypes.GENERATION_STOPPED, () => {
        if (interceptActive && !isValidating) {
            addDebugLog('info', 'Generation stopped - scheduling cleanup in 3s');
            if (generationCleanupTimeout) clearTimeout(generationCleanupTimeout);
            generationCleanupTimeout = setTimeout(() => {
                generationCleanupTimeout = null;
                if (interceptActive && !isValidating) {
                    addDebugLog('info', 'Generation cleanup timeout fired - no MESSAGE_RECEIVED, resetting');
                    resetState();
                }
            }, 3000);
        }
    });

    // Clean up on chat change
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        resetState();
        addDebugLog('info', 'Chat changed - state reset');
    });

    // Initialize the prompt interceptor for OOC injection
    initPromptInterceptor();

    console.log('[BFValidator] Validator initialized');
}
