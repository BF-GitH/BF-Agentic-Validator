// BF's Agentic Response Validator - Local Quick-Check (Stage 0)
// Fast pre-filter: N-gram echo detection, regex cliche patterns, word count

/**
 * Default cliche patterns - common purple prose and overwrought metaphors
 * Stored as regex source strings (case-insensitive matching applied at runtime)
 * @type {string[]}
 */
const DEFAULT_CLICHE_PATTERNS = [
    'a (?:dance|symphony|tapestry|kaleidoscope) of',
    'electricity (?:coursed|ran|shot) through',
    '(?:couldn\'t|could not) help but',
    'a (?:wave|surge|rush) of (?:\\w+ )?(?:emotion|feeling)',
    '(?:her|his|their) heart (?:skipped|missed) a beat',
    'time (?:seemed to |)(?:stand still|stop|freeze)',
    'something shifted',
    'with military precision',
    'like .+ owed (?:her|him|them) money',
    'the world (?:fell|melted) away',
    'eyes (?:widened|went wide)',
    'sent (?:a )?shiver(?:s)? down (?:her|his|their) spine',
    '(?:a |the )(?:fire|spark|flame) (?:ignited|burned|blazed) (?:in|within)',
    '(?:her|his|their) breath (?:caught|hitched)',
    'a (?:myriad|plethora|cornucopia) of',
    '(?:palpable|thick) (?:tension|silence)',
    'an (?:unspoken|silent) (?:understanding|agreement|promise)',
    'the air (?:crackled|hummed|buzzed) with',
    '(?:her|his|their) (?:voice|words) (?:dripped|oozed) with',
    '(?:a |the )familiar (?:warmth|ache|pang)',
];

/**
 * Get a copy of the default cliche patterns
 * @returns {string[]}
 */
export function getDefaultClichePatterns() {
    return [...DEFAULT_CLICHE_PATTERNS];
}

/**
 * Check text against cliche patterns
 * @param {string} text - Text to check
 * @param {string[]} patterns - All pattern source strings to check
 * @returns {{found: boolean, matches: string[]}} Results
 */
export function checkClichePatterns(text, patterns = []) {
    if (!text) return { found: false, matches: [] };

    const matches = [];

    for (const patternStr of patterns) {
        try {
            const regex = new RegExp(patternStr, 'i');
            const match = text.match(regex);
            if (match) {
                matches.push(match[0]);
            }
        } catch (e) {
            // Skip invalid regex patterns
        }
    }

    return { found: matches.length > 0, matches };
}

/**
 * Check word count against min/max bounds
 * @param {string} text - Text to check
 * @param {number} min - Minimum word count (0 = disabled)
 * @param {number} max - Maximum word count (0 = disabled)
 * @returns {{pass: boolean, wordCount: number, issue: string|null}}
 */
export function checkWordCount(text, min = 0, max = 0) {
    if (!text) return { pass: true, wordCount: 0, issue: null };

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    if (min > 0 && wordCount < min) {
        return { pass: false, wordCount, issue: `Too short: ${wordCount} words (minimum: ${min})` };
    }

    if (max > 0 && wordCount > max) {
        return { pass: false, wordCount, issue: `Too long: ${wordCount} words (maximum: ${max})` };
    }

    return { pass: true, wordCount, issue: null };
}

/**
 * @typedef {Object} LocalCheckIssue
 * @property {'cliche'|'wordcount'} type - Issue type (maps to feedback template)
 * @property {string} message - Human-readable description
 */

/**
 * Run all local checks (Stage 0)
 * Returns typed issues so the validator can pick the right feedback template per issue.
 * @param {string} response - AI response text
 * @param {object} localSettings - localCheck settings object
 * @returns {{pass: boolean, issues: LocalCheckIssue[]}} Results
 */
export function runLocalChecks(response, localSettings) {
    if (!localSettings?.enabled) {
        return { pass: true, issues: [] };
    }

    const issues = [];

    // Word count check (first)
    const wordResult = checkWordCount(response, localSettings.minWords || 0, localSettings.maxWords || 0);
    if (!wordResult.pass) {
        const isMin = wordResult.issue.startsWith('Too short');
        issues.push({
            type: isMin ? 'wordcount_min' : 'wordcount_max',
            message: wordResult.issue,
        });
    }

    // Cliche pattern check (second)
    if (localSettings.clichePatternsEnabled) {
        const clicheResult = checkClichePatterns(response, localSettings.clichePatterns || []);
        if (clicheResult.found) {
            issues.push({
                type: 'cliche',
                message: `"${clicheResult.matches.join('", "')}"`,
            });
        }
    }

    return { pass: issues.length === 0, issues };
}

/**
 * Escape user-selected text into a safe regex pattern string
 * @param {string} text - Plain text to convert to pattern
 * @returns {string} Escaped regex pattern string
 */
export function textToPattern(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
