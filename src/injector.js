// BF's Agentic Response Validator - OOC Injection Module
// Handles injection of correction hints into user messages

const OOC_MARKER = '<!-- BF_VALIDATOR_OOC -->';

/**
 * Get default feedback template for cliche detection (Stage 0)
 * @returns {string}
 */
export function getDefaultClicheFeedbackTemplate() {
    return `[OOC Instruction: Don't use the following phrases in your reply: {reason}.]`;
}

/**
 * Get default feedback template for word count too long (Stage 0)
 * @returns {string}
 */
export function getDefaultWordCountMaxFeedbackTemplate() {
    return `[OOC Instruction: Use max {max} words to reply.]`;
}

/**
 * Get default feedback template for word count too short (Stage 0)
 * @returns {string}
 */
export function getDefaultWordCountMinFeedbackTemplate() {
    return `[OOC Instruction: Use min {min} words to reply.]`;
}

/**
 * Get the default quality feedback template (Stage 1 / LLM check failure)
 * @returns {string}
 */
export function getDefaultQualityFeedbackTemplate() {
    return `[OOC Instruction: {reason}.]`;
}

/**
 * Build feedback OOC message for a specific failure type
 * @param {string} type - 'cliche', 'wordcount', 'echo_overlap', or 'quality'
 * @param {object} params - Template parameters
 * @param {string} params.reason - Why validation failed
 * @param {string} params.criteria - Quality criteria (for quality type)
 * @param {number} params.attempt - Current attempt number
 * @param {number} params.maxAttempts - Maximum attempts
 * @param {string} [params.template] - Custom template override
 * @returns {string} Formatted OOC message with marker
 */
export function buildFeedbackOOC(type, params) {
    let template;

    if (params.template) {
        template = params.template;
    } else if (type === 'cliche') {
        template = getDefaultClicheFeedbackTemplate();
    } else if (type === 'wordcount_max') {
        template = getDefaultWordCountMaxFeedbackTemplate();
    } else if (type === 'wordcount_min') {
        template = getDefaultWordCountMinFeedbackTemplate();
    } else {
        template = getDefaultQualityFeedbackTemplate();
    }

    const ooc = template
        .replace('{reason}', params.reason || 'Unknown issue')
        .replace('{attempt}', String(params.attempt || 1))
        .replace('{max_attempts}', String(params.maxAttempts || 3))
        .replace('{max}', String(params.max || ''))
        .replace('{min}', String(params.min || ''));

    return `${OOC_MARKER}\n${ooc}`;
}

/**
 * Inject OOC correction into the last user message in a chat array
 * @param {Array} messages - Array of message objects
 * @param {string} ooc - OOC content to inject
 * @param {string} mode - 'append' or 'prepend'
 * @returns {boolean} True if injection succeeded
 */
export function injectIntoLastUserMessage(messages, ooc, mode = 'append') {
    try {
        if (!Array.isArray(messages) || messages.length === 0) {
            console.log('[BFValidator] No messages to inject into');
            return false;
        }

        const separator = '\n\n';

        // Find last user message
        let lastUserIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg && msg.role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        if (lastUserIndex === -1) {
            console.log('[BFValidator] No user message found');
            return false;
        }

        const msg = messages[lastUserIndex];

        // Handle string content
        if (typeof msg.content === 'string') {
            // Check if already injected
            if (msg.content.includes(OOC_MARKER)) {
                const markerIndex = msg.content.indexOf(OOC_MARKER);
                msg.content = msg.content.substring(0, markerIndex).trim();
            }

            if (mode === 'prepend') {
                msg.content = ooc + separator + msg.content;
            } else {
                msg.content = msg.content + separator + ooc;
            }

            console.log('[BFValidator] Injected OOC into string content');
            return true;
        }

        // Handle array content (multimodal)
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && part.type === 'text' && typeof part.text === 'string') {
                    // Check if already injected
                    if (part.text.includes(OOC_MARKER)) {
                        const markerIndex = part.text.indexOf(OOC_MARKER);
                        part.text = part.text.substring(0, markerIndex).trim();
                    }

                    if (mode === 'prepend') {
                        part.text = ooc + separator + part.text;
                    } else {
                        part.text = part.text + separator + ooc;
                    }

                    console.log('[BFValidator] Injected OOC into array content');
                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        console.error('[BFValidator] Error injecting OOC:', error);
        return false;
    }
}

/**
 * Remove OOC marker from message content
 * @param {string} content - Message content
 * @returns {string} Content with OOC marker removed
 */
export function removeOOCMarker(content) {
    if (typeof content !== 'string') return content;

    const markerIndex = content.indexOf(OOC_MARKER);
    if (markerIndex === -1) return content;

    return content.substring(0, markerIndex).trim();
}

/**
 * Check if content contains our OOC marker
 * @param {string} content - Content to check
 * @returns {boolean} True if marker present
 */
export function hasOOCMarker(content) {
    if (typeof content !== 'string') return false;
    return content.includes(OOC_MARKER);
}
