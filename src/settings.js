// BF's Agentic Response Validator - Settings Module
// Handles UI, settings persistence, and presets

import { getConnectionProfiles, getCurrentProfileId } from './profiler.js';
import { getDefaultQualityFeedbackTemplate, getDefaultClicheFeedbackTemplate, getDefaultWordCountMaxFeedbackTemplate, getDefaultWordCountMinFeedbackTemplate } from './injector.js';
import { getDefaultClichePatterns } from './local-checker.js';
// Dynamic import to avoid crashing the module if the path differs across ST installs
let Popup, POPUP_TYPE;
async function ensurePopup() {
    if (Popup) return true;
    const paths = ['../../../../popup.js', '../../../../../popup.js', '../../../../scripts/popup.js'];
    for (const p of paths) {
        try {
            const mod = await import(p);
            Popup = mod.Popup;
            POPUP_TYPE = mod.POPUP_TYPE;
            return true;
        } catch (e) {
            // Try next path
        }
    }
    console.error('[BFValidator] Could not load Popup module from any path');
    return false;
}

// Derive extension folder name from actual URL to avoid case-sensitivity issues on Linux/Android
const EXTENSION_NAME = (() => {
    try {
        const url = new URL(import.meta.url);
        const parts = url.pathname.split('/');
        // URL looks like: /scripts/extensions/third-party/FOLDER_NAME/src/settings.js
        const srcIdx = parts.lastIndexOf('src');
        if (srcIdx > 0) return parts[srcIdx - 1];
    } catch (e) { /* fallback */ }
    return 'bf-agentic-validator';
})();

let extensionSettings = null;
let debugLog = [];
const MAX_DEBUG_ENTRIES = 200;

// Default quality check prompt
const DEFAULT_QUALITY_PROMPT = `You are a quality checker for creative roleplay writing.

=== PREVIOUS MESSAGES (CONTEXT ONLY — DO NOT EVALUATE) ===
These are prior messages for story context only. Do NOT check or judge these.
{recentMessages}

=== RULES ===
{rules}

=== CURRENT REPLY (CHECK ONLY THIS) ===
Apply the rules ONLY to this reply. Do NOT evaluate the previous messages above.
{response}

Which rules were broken? Reply ONLY with the broken rule numbers separated by commas.
If all rules pass, reply with: pass
Example: 1, 3`;

const DEFAULT_SETTINGS = {
    enabled: false,
    agenticMode: true,
    maxRetries: 3,
    showToast: true,
    debugMode: false,

    // Profile (optional - default = current model, no switching)
    useValidatorProfile: false,
    validatorProfile: null,

    // Stage 0: Local Check
    localCheck: {
        enabled: true,
        clichePatternsEnabled: true,
        clichePatterns: null, // null = will be populated with defaults on init
        minWords: 0,
        maxWords: 0,
        // Per-issue feedback templates (editable in UI)
        feedbackTemplates: {
            cliche: '',
            wordcount_max: '',
            wordcount_min: '',
        },
    },

    // Stage 1: Quality Check (LLM)
    qualityCheck: {
        enabled: true,
        prompt: DEFAULT_QUALITY_PROMPT,
        rules: [],
        savedPresets: {},
        contextMessages: 5,
        feedbackTemplate: '',
    },

    // Presets
    currentPreset: 'Default',
    presets: {},
};

// Individual rule presets (click to add one rule)
const RULE_PRESETS = {
    'Heroine Only': {
        check: 'Only the main heroine character is allowed to have spoken dialogue. No other characters should have dialogue lines. Side characters can be referenced or described but must NOT speak directly with quotation marks.',
        ooc: 'Only write dialogue for the main heroine.',
    },
    'Natural Dialogue': {
        check: 'The dialogue must feel natural and informal, NOT formal, robotic, or hyperanalytical. Avoid stilted phrasing, overly proper grammar in casual speech, or characters sounding like they\'re giving a lecture. Dialogue should have natural flow with varied sentence lengths and conversational spontaneity.',
        ooc: 'Write natural, casual dialogue.',
    },
    'No Cliches': {
        check: 'Avoid cliche writing phrases and forced comparisons. Do NOT use phrases like "with military precision", "like it owed her money", "a dance of...", "symphony of...", or similar overwrought metaphors. Prefer simple, direct, informal prose without unnecessary similes or purple prose.',
        ooc: 'Use simple, direct prose. No cliches or purple prose.',
    },
    'No Echoes': {
        check: 'The response must NOT directly quote or closely paraphrase the user\'s message. Avoid referring back to previous story events unnecessarily. Each response should move forward without repetitive callbacks.',
        ooc: 'Don\'t repeat or paraphrase what the user said. Move forward.',
    },
    'No Repetition': {
        check: 'The response must NOT repeat phrases or sentences from the previous AI message or heavily echo the user\'s input. Each response should feel fresh and progressing.',
        ooc: 'Don\'t repeat phrases from your previous message.',
    },
    'Beyond Profession': {
        check: 'The character must NOT be one-dimensional or overly focused on their profession/role. Show the character as a complete human with varied interests, emotions, and reactions. Avoid making every response revolve around their job or primary trait.',
        ooc: 'Show the character as a full person, not just their job.',
    },
    'Third Person': {
        check: 'The response must be written entirely in third person narrative. It must NOT use first person pronouns (I, me, my, mine, myself) from the character\'s perspective.',
        ooc: 'Write in third person only.',
    },
    'No Asterisks': {
        check: 'The response must NOT contain any asterisks (*) for actions or emphasis. All actions should be written in plain prose without roleplay notation.',
        ooc: 'Don\'t use asterisks for actions. Write in plain prose.',
    },
    'Minimum Length': {
        check: 'The response must be at least 100 words long. Short responses that are under this word count are not acceptable.',
        ooc: 'Write at least 100 words.',
    },
    'No OOC': {
        check: 'The response must stay completely in character. It must NOT contain any out-of-character commentary, author notes, parenthetical asides (like (OOC:)), or meta-references to being an AI.',
        ooc: 'Stay in character. No meta-commentary.',
    },
    'Dialogue Focus': {
        check: 'The response must contain actual spoken dialogue from the character. Responses that are entirely internal monologue or narration without any spoken words are not acceptable.',
        ooc: 'Include spoken dialogue in your response.',
    },
};

// Default full presets seeded on first init
const DEFAULT_FULL_PRESETS = {
    'BF Complete': [
        { name: 'Natural Dialogue', check: RULE_PRESETS['Natural Dialogue'].check, ooc: RULE_PRESETS['Natural Dialogue'].ooc, enabled: true },
        { name: 'Heroine Only', check: RULE_PRESETS['Heroine Only'].check, ooc: RULE_PRESETS['Heroine Only'].ooc, enabled: true },
        { name: 'No Echoes', check: RULE_PRESETS['No Echoes'].check, ooc: RULE_PRESETS['No Echoes'].ooc, enabled: true },
        { name: 'Beyond Profession', check: RULE_PRESETS['Beyond Profession'].check, ooc: RULE_PRESETS['Beyond Profession'].ooc, enabled: true },
        { name: 'No Cliches', check: RULE_PRESETS['No Cliches'].check, ooc: RULE_PRESETS['No Cliches'].ooc, enabled: true },
    ],
};

/**
 * Get current extension settings
 * @returns {object} Settings object
 */
export function getSettings() {
    return extensionSettings;
}

/**
 * Get the default quality prompt (for reset)
 * @returns {string}
 */
export function getDefaultQualityPrompt() {
    return DEFAULT_QUALITY_PROMPT;
}

/**
 * Save settings to SillyTavern
 */
function saveSettings() {
    const context = SillyTavern.getContext();
    context.extensionSettings[EXTENSION_NAME] = extensionSettings;
    context.saveSettingsDebounced();
}

/**
 * Escape HTML for safe insertion
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Update the status display
 * @param {string} status - Status type: 'idle', 'validating', 'error'
 * @param {string} message - Optional status message
 */
export function updateStatus(status, message = '') {
    const statusDot = document.getElementById('bf_validator_status_dot');
    const statusText = document.getElementById('bf_validator_status_text');

    if (statusDot) {
        statusDot.className = 'bf-validator-status-dot';
        if (status === 'validating') {
            statusDot.classList.add('validating');
        } else if (status === 'error') {
            statusDot.classList.add('error');
        } else if (extensionSettings?.enabled) {
            statusDot.classList.add('active');
        }
    }

    if (statusText && message) {
        statusText.textContent = message;
    } else if (statusText) {
        if (!extensionSettings?.enabled) {
            statusText.textContent = 'Disabled';
        } else {
            const mode = extensionSettings.agenticMode ? 'Agentic' : 'Monitor only';
            const model = extensionSettings.useValidatorProfile && extensionSettings.validatorProfile
                ? ' (separate profile)'
                : '';
            statusText.textContent = `Active - ${mode}${model}`;
        }
    }
}

/**
 * Add entry to debug log
 */
export function addDebugLog(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    debugLog.unshift({ type, message, timestamp });

    if (debugLog.length > MAX_DEBUG_ENTRIES) {
        debugLog = debugLog.slice(0, MAX_DEBUG_ENTRIES);
    }

    renderDebugLog();

    if (extensionSettings?.debugMode) {
        const prefix = type === 'pass' ? '[PASS]' : type === 'fail' ? '[FAIL]' : '[INFO]';
        console.log(`[BFValidator] ${prefix} ${message}`);
    }
}

/**
 * Render the debug log panel
 */
function renderDebugLog() {
    const container = document.getElementById('bf_validator_debug_log');
    if (!container) return;

    container.innerHTML = debugLog.map(entry => `
        <div class="bf-validator-debug-entry ${entry.type}">
            <span style="color: #666;">[${entry.timestamp}]</span> ${escapeHtml(entry.message).replace(/\n/g, '<br>')}
        </div>
    `).join('');
}

/**
 * Export all logs as formatted text
 */
export function exportLogs() {
    const header = `=== BF Validator Debug Logs ===
Exported: ${new Date().toISOString()}
Extension Enabled: ${extensionSettings?.enabled}
Validator Profile: ${extensionSettings?.validatorProfile || 'Not set (using current model)'}
Total Entries: ${debugLog.length}
${'='.repeat(40)}

`;

    const logText = debugLog.map(entry => {
        const typeTag = entry.type.toUpperCase().padEnd(5);
        return `[${entry.timestamp}] [${typeTag}] ${entry.message}`;
    }).join('\n');

    return header + logText;
}

/**
 * Copy logs to clipboard
 */
async function copyLogsToClipboard() {
    const logText = exportLogs();
    try {
        await navigator.clipboard.writeText(logText);
        toastr.success('Logs copied to clipboard!', 'BF Validator');
    } catch (err) {
        console.error('[BFValidator] Failed to copy logs:', err);
        prompt('Copy these logs:', logText);
    }
}

/**
 * Reload profile dropdown options
 */
function reloadProfiles() {
    const select = document.getElementById('bf_validator_profile');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">-- Select Validator Profile --</option>';

    const profiles = getConnectionProfiles();
    const currentProfile = getCurrentProfileId();

    profiles.forEach(profile => {
        const isCurrent = profile.id === currentProfile;
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name + (isCurrent ? ' (current)' : '');
        select.appendChild(option);
    });

    if (currentValue && profiles.find(p => p.id === currentValue)) {
        select.value = currentValue;
    } else if (extensionSettings?.validatorProfile) {
        select.value = extensionSettings.validatorProfile;
    }
}

/**
 * Update preset dropdown
 */
function updatePresetDropdown() {
    const select = document.getElementById('bf_validator_preset_select');
    if (!select) return;

    select.innerHTML = '<option value="Default">Default</option>';

    if (extensionSettings?.presets) {
        Object.keys(extensionSettings.presets).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    if (extensionSettings?.currentPreset) {
        select.value = extensionSettings.currentPreset;
    }
}

/**
 * Save current settings as a preset
 */
function savePreset(name) {
    if (!name || name.trim() === '' || name === 'Default') {
        toastr.error('Invalid preset name', 'BF Validator');
        return;
    }

    if (!extensionSettings.presets) {
        extensionSettings.presets = {};
    }

    extensionSettings.presets[name] = {
        localCheck: JSON.parse(JSON.stringify(extensionSettings.localCheck)),
        qualityCheck: JSON.parse(JSON.stringify(extensionSettings.qualityCheck)),
        agenticMode: extensionSettings.agenticMode,
        maxRetries: extensionSettings.maxRetries,
        useValidatorProfile: extensionSettings.useValidatorProfile,
        validatorProfile: extensionSettings.validatorProfile,
    };

    extensionSettings.currentPreset = name;
    saveSettings();
    updatePresetDropdown();
    toastr.success(`Preset "${name}" saved`, 'BF Validator');
}

/**
 * Load a preset
 */
function loadPreset(name) {
    if (name === 'Default') {
        extensionSettings.localCheck = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.localCheck));
        extensionSettings.localCheck.clichePatterns = getDefaultClichePatterns();
        extensionSettings.qualityCheck = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.qualityCheck));
        extensionSettings.agenticMode = true;
        extensionSettings.maxRetries = 3;
        extensionSettings.useValidatorProfile = false;
        extensionSettings.validatorProfile = null;
    } else if (extensionSettings.presets && extensionSettings.presets[name]) {
        const preset = extensionSettings.presets[name];
        if (preset.localCheck) extensionSettings.localCheck = JSON.parse(JSON.stringify(preset.localCheck));
        if (preset.qualityCheck) extensionSettings.qualityCheck = JSON.parse(JSON.stringify(preset.qualityCheck));
        extensionSettings.agenticMode = preset.agenticMode !== undefined ? preset.agenticMode : true;
        extensionSettings.maxRetries = preset.maxRetries || 3;
        extensionSettings.useValidatorProfile = preset.useValidatorProfile || false;
        extensionSettings.validatorProfile = preset.validatorProfile || null;
    } else {
        toastr.error(`Preset "${name}" not found`, 'BF Validator');
        return;
    }

    extensionSettings.currentPreset = name;
    saveSettings();
    refreshUI();
    toastr.success(`Preset "${name}" loaded`, 'BF Validator');
}

/**
 * Delete a preset
 */
function deletePreset(name) {
    if (name === 'Default') {
        toastr.error('Cannot delete Default preset', 'BF Validator');
        return;
    }

    if (!extensionSettings.presets || !extensionSettings.presets[name]) {
        toastr.error(`Preset "${name}" not found`, 'BF Validator');
        return;
    }

    if (!confirm(`Delete preset "${name}"?`)) return;

    delete extensionSettings.presets[name];

    if (extensionSettings.currentPreset === name) {
        extensionSettings.currentPreset = 'Default';
    }

    saveSettings();
    updatePresetDropdown();
    toastr.success(`Preset "${name}" deleted`, 'BF Validator');
}

/**
 * Update the cliche pattern count display in settings
 */
function updateClicheCount() {
    const countEl = document.getElementById('bf_validator_cliche_count');
    if (!countEl) return;
    const count = extensionSettings.localCheck.clichePatterns?.length || 0;
    countEl.textContent = `(${count} pattern${count !== 1 ? 's' : ''})`;
}

/**
 * Open the cliche pattern manager popup
 */
async function openClichePatternManager() {
    const patterns = extensionSettings.localCheck.clichePatterns || [];

    const container = document.createElement('div');
    container.classList.add('bf-validator-pattern-manager');

    // Build pattern list
    const listEl = document.createElement('div');
    listEl.classList.add('bf-validator-pattern-list');
    container.appendChild(listEl);

    function renderList() {
        const currentPatterns = extensionSettings.localCheck.clichePatterns || [];
        listEl.innerHTML = '';

        if (currentPatterns.length === 0) {
            listEl.innerHTML = '<div class="bf-validator-info">No patterns. Add one below or reset to defaults.</div>';
            return;
        }

        currentPatterns.forEach((pattern, index) => {
            const row = document.createElement('div');
            row.classList.add('bf-validator-pm-row');

            const input = document.createElement('input');
            input.type = 'text';
            input.classList.add('text_pole', 'bf-validator-pm-input');
            input.value = pattern;
            input.dataset.index = index;

            input.addEventListener('change', () => {
                const val = input.value.trim();
                if (!val) {
                    // Empty = delete
                    extensionSettings.localCheck.clichePatterns.splice(index, 1);
                    saveSettings();
                    updateClicheCount();
                    renderList();
                    return;
                }
                // Validate regex
                try {
                    new RegExp(val, 'i');
                    extensionSettings.localCheck.clichePatterns[index] = val;
                    saveSettings();
                    updateClicheCount();
                } catch (e) {
                    toastr.error(`Invalid regex: ${e.message}`, 'BF Validator');
                    input.value = extensionSettings.localCheck.clichePatterns[index];
                }
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('menu_button', 'bf-validator-pm-delete');
            deleteBtn.title = 'Delete pattern';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.addEventListener('click', () => {
                extensionSettings.localCheck.clichePatterns.splice(index, 1);
                saveSettings();
                updateClicheCount();
                renderList();
            });

            row.appendChild(input);
            row.appendChild(deleteBtn);
            listEl.appendChild(row);
        });
    }

    // Add-new section
    const addRow = document.createElement('div');
    addRow.classList.add('bf-validator-pm-add-row');

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.classList.add('text_pole', 'bf-validator-pm-input');
    addInput.placeholder = 'New pattern (regex)...';

    const addBtn = document.createElement('button');
    addBtn.classList.add('menu_button');
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';

    function doAdd() {
        const val = addInput.value.trim();
        if (!val) return;

        // Validate regex
        try {
            new RegExp(val, 'i');
        } catch (e) {
            toastr.error(`Invalid regex: ${e.message}`, 'BF Validator');
            return;
        }

        // Don't add duplicates
        if (extensionSettings.localCheck.clichePatterns.includes(val)) {
            toastr.warning('Pattern already exists', 'BF Validator');
            return;
        }

        extensionSettings.localCheck.clichePatterns.push(val);
        saveSettings();
        updateClicheCount();
        addInput.value = '';
        renderList();
    }

    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doAdd();
        }
    });

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    container.appendChild(addRow);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.classList.add('menu_button');
    resetBtn.innerHTML = '<i class="fa-solid fa-undo"></i> Reset to Defaults';
    resetBtn.style.marginTop = '10px';
    resetBtn.addEventListener('click', () => {
        if (!confirm('Reset all patterns to defaults? Custom patterns will be lost.')) return;
        extensionSettings.localCheck.clichePatterns = getDefaultClichePatterns();
        saveSettings();
        updateClicheCount();
        renderList();
        toastr.info('Patterns reset to defaults', 'BF Validator');
    });
    container.appendChild(resetBtn);

    renderList();

    if (!await ensurePopup()) {
        // Fallback: use a simple alert-style display
        toastr.error('Popup module unavailable. Patterns saved automatically.', 'BF Validator');
        return;
    }

    const popup = new Popup(container, POPUP_TYPE.TEXT, '', {
        okButton: 'Done',
        cancelButton: false,
        wide: true,
        allowVerticalScrolling: true,
    });
    await popup.show();
}

/**
 * Add a cliche pattern to the list
 * @param {string} pattern - Regex pattern string
 */
export function addCustomClichePattern(pattern) {
    if (!extensionSettings.localCheck.clichePatterns) {
        extensionSettings.localCheck.clichePatterns = getDefaultClichePatterns();
    }

    // Don't add duplicates
    if (extensionSettings.localCheck.clichePatterns.includes(pattern)) {
        return false;
    }

    extensionSettings.localCheck.clichePatterns.push(pattern);
    saveSettings();
    updateClicheCount();
    return true;
}

/**
 * Remove a cliche pattern from the list
 * @param {string} pattern - Pattern string to remove
 */
export function removeCustomClichePattern(pattern) {
    if (!extensionSettings.localCheck.clichePatterns) return false;

    const idx = extensionSettings.localCheck.clichePatterns.indexOf(pattern);
    if (idx === -1) return false;

    extensionSettings.localCheck.clichePatterns.splice(idx, 1);
    saveSettings();
    updateClicheCount();
    return true;
}

/**
 * Check if a pattern exists in the cliche patterns list
 * @param {string} pattern - Pattern string to check
 * @returns {boolean}
 */
export function hasCustomClichePattern(pattern) {
    return extensionSettings?.localCheck?.clichePatterns?.includes(pattern) || false;
}

/**
 * Refresh UI to match current settings
 */
function refreshUI() {
    // Main toggle
    $('#bf_validator_enabled').prop('checked', extensionSettings.enabled);
    $('#bf_validator_settings_content').toggle(extensionSettings.enabled);

    // Agentic mode
    $('#bf_validator_agentic_mode').prop('checked', extensionSettings.agenticMode);

    // Profile
    $('#bf_validator_use_profile').prop('checked', extensionSettings.useValidatorProfile);
    $('#bf_validator_profile_section').toggle(extensionSettings.useValidatorProfile);
    $('#bf_validator_profile').val(extensionSettings.validatorProfile || '');

    // Stage 0: Local Check
    $('#bf_validator_local_enabled').prop('checked', extensionSettings.localCheck.enabled);
    $('#bf_validator_cliche_enabled').prop('checked', extensionSettings.localCheck.clichePatternsEnabled);
    $('#bf_validator_min_words').val(extensionSettings.localCheck.minWords);
    $('#bf_validator_max_words').val(extensionSettings.localCheck.maxWords);

    // Stage 0: Feedback templates (empty setting = show default text in textarea)
    $('#bf_validator_cliche_feedback').val(extensionSettings.localCheck.feedbackTemplates?.cliche || getDefaultClicheFeedbackTemplate());
    $('#bf_validator_wordcount_max_feedback').val(extensionSettings.localCheck.feedbackTemplates?.wordcount_max || getDefaultWordCountMaxFeedbackTemplate());
    $('#bf_validator_wordcount_min_feedback').val(extensionSettings.localCheck.feedbackTemplates?.wordcount_min || getDefaultWordCountMinFeedbackTemplate());

    // Stage 1: Quality Check
    $('#bf_validator_quality_enabled').prop('checked', extensionSettings.qualityCheck.enabled);
    $('#bf_validator_quality_prompt').val(extensionSettings.qualityCheck.prompt);
    $('#bf_validator_quality_context').val(extensionSettings.qualityCheck.contextMessages);
    $('#bf_validator_quality_context_val').text(extensionSettings.qualityCheck.contextMessages);
    $('#bf_validator_quality_feedback').val(extensionSettings.qualityCheck.feedbackTemplate || getDefaultQualityFeedbackTemplate());
    renderRulesList();
    updateFullPresetDropdown();

    // General
    $('#bf_validator_max_retries').val(extensionSettings.maxRetries);
    $('#bf_validator_show_toast').prop('checked', extensionSettings.showToast);
    $('#bf_validator_debug').prop('checked', extensionSettings.debugMode);
    $('#bf_validator_debug_panel').toggle(extensionSettings.debugMode);

    updateStatus('idle');
    reloadProfiles();
    updateClicheCount();
}

/**
 * Render a single rule card HTML
 * @param {object} rule - Rule object {name, check, ooc, enabled}
 * @param {number} index - Index in the rules array
 * @returns {string} HTML string
 */
function renderRuleCard(rule, index) {
    return `
        <div class="bf-validator-rule-card collapsed" data-rule-index="${index}">
            <div class="bf-validator-rule-header">
                <label class="checkbox_label bf-validator-rule-toggle">
                    <input type="checkbox" class="bf-validator-rule-enabled" data-index="${index}" ${rule.enabled ? 'checked' : ''} />
                </label>
                <input type="text" class="bf-validator-rule-name" data-index="${index}" value="${escapeHtml(rule.name)}" placeholder="Rule name..." />
                <button class="bf-validator-rule-chevron" data-index="${index}" title="Expand/collapse">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button class="bf-validator-rule-delete" data-index="${index}" title="Delete rule">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            <div class="bf-validator-rule-body">
                <label style="color: #aaa; font-size: 0.85em;">LLM Check:</label>
                <textarea class="bf-validator-textarea bf-validator-rule-check" data-index="${index}" style="min-height: 60px;">${escapeHtml(rule.check)}</textarea>
                <label style="color: #aaa; font-size: 0.85em; margin-top: 6px; display: block;">OOC Instruction:</label>
                <textarea class="bf-validator-textarea bf-validator-rule-ooc" data-index="${index}" style="min-height: 40px;">${escapeHtml(rule.ooc)}</textarea>
            </div>
        </div>`;
}

/**
 * Render the full rules list in the container
 */
function renderRulesList() {
    const container = document.getElementById('bf_validator_rules_container');
    if (!container) return;

    const rules = extensionSettings.qualityCheck.rules || [];
    if (rules.length === 0) {
        container.innerHTML = '<div class="bf-validator-info">No rules configured. Add rules using the presets above or the custom rule button below.</div>';
        return;
    }

    container.innerHTML = rules.map((rule, i) => renderRuleCard(rule, i)).join('');

    // Attach event listeners to rule cards
    container.querySelectorAll('.bf-validator-rule-enabled').forEach(el => {
        el.addEventListener('change', function () {
            const idx = parseInt(this.dataset.index);
            extensionSettings.qualityCheck.rules[idx].enabled = this.checked;
            saveSettings();
        });
    });

    container.querySelectorAll('.bf-validator-rule-name').forEach(el => {
        el.addEventListener('change', function () {
            const idx = parseInt(this.dataset.index);
            extensionSettings.qualityCheck.rules[idx].name = this.value;
            saveSettings();
        });
    });

    container.querySelectorAll('.bf-validator-rule-chevron').forEach(el => {
        el.addEventListener('click', function () {
            const card = this.closest('.bf-validator-rule-card');
            card.classList.toggle('collapsed');
        });
    });

    container.querySelectorAll('.bf-validator-rule-delete').forEach(el => {
        el.addEventListener('click', function () {
            const idx = parseInt(this.dataset.index);
            extensionSettings.qualityCheck.rules.splice(idx, 1);
            saveSettings();
            renderRulesList();
        });
    });

    container.querySelectorAll('.bf-validator-rule-check').forEach(el => {
        el.addEventListener('change', function () {
            const idx = parseInt(this.dataset.index);
            extensionSettings.qualityCheck.rules[idx].check = this.value;
            saveSettings();
        });
    });

    container.querySelectorAll('.bf-validator-rule-ooc').forEach(el => {
        el.addEventListener('change', function () {
            const idx = parseInt(this.dataset.index);
            extensionSettings.qualityCheck.rules[idx].ooc = this.value;
            saveSettings();
        });
    });
}

/**
 * Add a rule from a preset
 * @param {string} presetName - Name of the rule preset
 */
function addRuleFromPreset(presetName) {
    const preset = RULE_PRESETS[presetName];
    if (!preset) return;

    if (!extensionSettings.qualityCheck.rules) {
        extensionSettings.qualityCheck.rules = [];
    }

    extensionSettings.qualityCheck.rules.push({
        name: presetName,
        check: preset.check,
        ooc: preset.ooc,
        enabled: true,
    });

    saveSettings();
    renderRulesList();
    toastr.info(`Added rule "${presetName}"`, 'BF Validator');
}

/**
 * Add a blank custom rule
 */
function addCustomRule() {
    if (!extensionSettings.qualityCheck.rules) {
        extensionSettings.qualityCheck.rules = [];
    }

    extensionSettings.qualityCheck.rules.push({
        name: 'Custom Rule',
        check: '',
        ooc: '',
        enabled: true,
    });

    saveSettings();
    renderRulesList();

    // Auto-expand the new card
    const container = document.getElementById('bf_validator_rules_container');
    const lastCard = container?.querySelector('.bf-validator-rule-card:last-child');
    if (lastCard) {
        lastCard.classList.remove('collapsed');
    }
}

/**
 * Save current rules as a full preset
 * @param {string} name - Preset name
 */
function saveFullPreset(name) {
    if (!name || !name.trim()) {
        toastr.error('Enter a preset name', 'BF Validator');
        return;
    }

    const rules = extensionSettings.qualityCheck.rules || [];
    if (rules.length === 0) {
        toastr.error('No rules to save', 'BF Validator');
        return;
    }

    if (!extensionSettings.qualityCheck.savedPresets) {
        extensionSettings.qualityCheck.savedPresets = {};
    }

    extensionSettings.qualityCheck.savedPresets[name.trim()] = JSON.parse(JSON.stringify(rules));
    saveSettings();
    updateFullPresetDropdown();
    toastr.success(`Preset "${name.trim()}" saved`, 'BF Validator');
}

/**
 * Load a full preset (replaces all rules)
 * @param {string} name - Preset name
 */
function loadFullPreset(name) {
    const rules = extensionSettings.qualityCheck.savedPresets?.[name];

    if (!rules) {
        toastr.error(`Preset "${name}" not found`, 'BF Validator');
        return;
    }

    extensionSettings.qualityCheck.rules = JSON.parse(JSON.stringify(rules));
    saveSettings();
    renderRulesList();
    toastr.info(`Loaded preset "${name}"`, 'BF Validator');
}

/**
 * Delete a saved full preset
 * @param {string} name - Preset name
 */
async function deleteFullPreset(name) {
    if (!extensionSettings.qualityCheck.savedPresets?.[name]) {
        toastr.error(`Preset "${name}" not found`, 'BF Validator');
        return;
    }

    if (!confirm(`Delete preset "${name}"?`)) return;

    delete extensionSettings.qualityCheck.savedPresets[name];
    saveSettings();
    updateFullPresetDropdown();
    toastr.success(`Preset "${name}" deleted`, 'BF Validator');
}

/**
 * Populate the full presets dropdown
 */
function updateFullPresetDropdown() {
    const select = document.getElementById('bf_validator_full_preset_select');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">-- No Preset --</option>';

    const saved = extensionSettings.qualityCheck.savedPresets || {};
    Object.keys(saved).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    // Restore selection if still valid
    if (currentValue && select.querySelector(`option[value="${CSS.escape(currentValue)}"]`)) {
        select.value = currentValue;
    }
}

/**
 * Setup ARIA-compliant tab navigation with keyboard support.
 */
function setupTabs() {
    const tablist = document.querySelector('.bf-validator-tabs[role="tablist"]');
    if (!tablist) return;

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;

    function activateTab(tab) {
        tabs.forEach(t => {
            t.setAttribute('aria-selected', 'false');
            t.setAttribute('tabindex', '-1');
            t.classList.remove('active');
            const panel = document.getElementById(t.getAttribute('aria-controls'));
            if (panel) {
                panel.style.display = 'none';
                panel.setAttribute('aria-hidden', 'true');
            }
        });

        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
        tab.classList.add('active');
        tab.focus();

        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) {
            panel.style.display = '';
            panel.setAttribute('aria-hidden', 'false');
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab));
        tab.addEventListener('keydown', (e) => {
            const idx = tabs.indexOf(tab);
            let target = null;

            if (e.key === 'ArrowRight') {
                target = tabs[(idx + 1) % tabs.length];
            } else if (e.key === 'ArrowLeft') {
                target = tabs[(idx - 1 + tabs.length) % tabs.length];
            } else if (e.key === 'Home') {
                target = tabs[0];
            } else if (e.key === 'End') {
                target = tabs[tabs.length - 1];
            }

            if (target) {
                e.preventDefault();
                activateTab(target);
            }
        });
    });
}

/**
 * Load the UI template and attach handlers
 */
async function loadUI() {
    let path = `scripts/extensions/third-party/${EXTENSION_NAME}`;
    let html = null;

    try {
        html = await $.get(`${path}/templates/settings.html`);
    } catch (e) {
        path = `scripts/extensions/${EXTENSION_NAME}`;
        try {
            html = await $.get(`${path}/templates/settings.html`);
        } catch (e2) {
            console.error('[BFValidator] Failed to load UI template from both paths');
            return;
        }
    }

    $('#extensions_settings').append(html);

    // === Main Toggle ===
    $('#bf_validator_enabled').prop('checked', extensionSettings.enabled).on('change', function () {
        extensionSettings.enabled = $(this).prop('checked');
        $('#bf_validator_settings_content').toggle(extensionSettings.enabled);
        updateStatus('idle');
        saveSettings();

        if (!extensionSettings.enabled) {
            // Clean up any validating markers
            document.querySelectorAll('.mes[data-bf-validating="true"]').forEach(el => {
                el.style.display = '';
                delete el.dataset.bfValidating;
            });
            // Hide checking indicator
            const indicator = document.getElementById('bf_validator_checking_indicator');
            if (indicator) indicator.style.display = 'none';
        }
    });

    // === Agentic Mode Toggle ===
    $('#bf_validator_agentic_mode').prop('checked', extensionSettings.agenticMode).on('change', function () {
        extensionSettings.agenticMode = $(this).prop('checked');
        updateStatus('idle');
        saveSettings();
    });

    // === Profile Section ===
    $('#bf_validator_use_profile').on('change', function () {
        extensionSettings.useValidatorProfile = $(this).prop('checked');
        $('#bf_validator_profile_section').toggle(extensionSettings.useValidatorProfile);
        saveSettings();
    });

    reloadProfiles();
    $('#bf_validator_profile').val(extensionSettings.validatorProfile || '').on('change', function () {
        extensionSettings.validatorProfile = $(this).val() || null;
        saveSettings();
    });

    $('#bf_validator_refresh_profiles').on('click', function () {
        reloadProfiles();
        toastr.info('Profiles refreshed', 'BF Validator');
    });

    // === Stage 0: Local Check ===
    $('#bf_validator_local_enabled').prop('checked', extensionSettings.localCheck.enabled).on('change', function () {
        extensionSettings.localCheck.enabled = $(this).prop('checked');
        saveSettings();
    });

    $('#bf_validator_cliche_enabled').prop('checked', extensionSettings.localCheck.clichePatternsEnabled).on('change', function () {
        extensionSettings.localCheck.clichePatternsEnabled = $(this).prop('checked');
        saveSettings();
    });

    $('#bf_validator_manage_cliches').on('click', function () {
        openClichePatternManager();
    });

    updateClicheCount();

    $('#bf_validator_min_words').val(extensionSettings.localCheck.minWords).on('change', function () {
        extensionSettings.localCheck.minWords = parseInt($(this).val()) || 0;
        saveSettings();
    });

    $('#bf_validator_max_words').val(extensionSettings.localCheck.maxWords).on('change', function () {
        extensionSettings.localCheck.maxWords = parseInt($(this).val()) || 0;
        saveSettings();
    });

    // === Stage 0: Per-issue feedback templates (save empty if matches default) ===
    $('#bf_validator_cliche_feedback').val(extensionSettings.localCheck.feedbackTemplates?.cliche || getDefaultClicheFeedbackTemplate()).on('change', function () {
        if (!extensionSettings.localCheck.feedbackTemplates) extensionSettings.localCheck.feedbackTemplates = {};
        const val = $(this).val().trim();
        extensionSettings.localCheck.feedbackTemplates.cliche = (val === getDefaultClicheFeedbackTemplate()) ? '' : val;
        saveSettings();
    });
    $('#bf_validator_wordcount_max_feedback').val(extensionSettings.localCheck.feedbackTemplates?.wordcount_max || getDefaultWordCountMaxFeedbackTemplate()).on('change', function () {
        if (!extensionSettings.localCheck.feedbackTemplates) extensionSettings.localCheck.feedbackTemplates = {};
        const val = $(this).val().trim();
        extensionSettings.localCheck.feedbackTemplates.wordcount_max = (val === getDefaultWordCountMaxFeedbackTemplate()) ? '' : val;
        saveSettings();
    });
    $('#bf_validator_wordcount_min_feedback').val(extensionSettings.localCheck.feedbackTemplates?.wordcount_min || getDefaultWordCountMinFeedbackTemplate()).on('change', function () {
        if (!extensionSettings.localCheck.feedbackTemplates) extensionSettings.localCheck.feedbackTemplates = {};
        const val = $(this).val().trim();
        extensionSettings.localCheck.feedbackTemplates.wordcount_min = (val === getDefaultWordCountMinFeedbackTemplate()) ? '' : val;
        saveSettings();
    });
    $('#bf_validator_reset_cliche_feedback').on('click', function () {
        extensionSettings.localCheck.feedbackTemplates.cliche = '';
        $('#bf_validator_cliche_feedback').val(getDefaultClicheFeedbackTemplate());
        saveSettings();
        toastr.info('Cliche feedback reset to default', 'BF Validator');
    });
    $('#bf_validator_reset_wordcount_max_feedback').on('click', function () {
        extensionSettings.localCheck.feedbackTemplates.wordcount_max = '';
        $('#bf_validator_wordcount_max_feedback').val(getDefaultWordCountMaxFeedbackTemplate());
        saveSettings();
        toastr.info('Word count (max) feedback reset to default', 'BF Validator');
    });
    $('#bf_validator_reset_wordcount_min_feedback').on('click', function () {
        extensionSettings.localCheck.feedbackTemplates.wordcount_min = '';
        $('#bf_validator_wordcount_min_feedback').val(getDefaultWordCountMinFeedbackTemplate());
        saveSettings();
        toastr.info('Word count (min) feedback reset to default', 'BF Validator');
    });
    // === Stage 1: Quality Check ===
    $('#bf_validator_quality_enabled').prop('checked', extensionSettings.qualityCheck.enabled).on('change', function () {
        extensionSettings.qualityCheck.enabled = $(this).prop('checked');
        saveSettings();
    });

    $('#bf_validator_quality_prompt').val(extensionSettings.qualityCheck.prompt).on('change', function () {
        extensionSettings.qualityCheck.prompt = $(this).val();
        saveSettings();
    });

    // Full presets: dropdown select + save/new/delete
    $('#bf_validator_full_preset_select').on('change', function () {
        const name = $(this).val();
        if (!name) return;
        loadFullPreset(name);
    });

    $('#bf_validator_full_preset_save').on('click', function () {
        const selected = $('#bf_validator_full_preset_select').val();
        if (selected) {
            // Overwrite selected preset
            saveFullPreset(selected);
        } else {
            // No preset selected — prompt for new name
            const name = prompt('Enter preset name:');
            if (name && name.trim()) {
                saveFullPreset(name.trim());
                $('#bf_validator_full_preset_select').val(name.trim());
            }
        }
    });

    $('#bf_validator_full_preset_new').on('click', function () {
        const name = prompt('Enter new preset name:');
        if (name && name.trim()) {
            saveFullPreset(name.trim());
            $('#bf_validator_full_preset_select').val(name.trim());
        }
    });

    $('#bf_validator_full_preset_delete').on('click', function () {
        const name = $('#bf_validator_full_preset_select').val();
        if (!name) {
            toastr.error('Select a preset to delete', 'BF Validator');
            return;
        }
        deleteFullPreset(name);
        $('#bf_validator_full_preset_select').val('');
    });

    updateFullPresetDropdown();

    // Rule presets: click to add individual rules
    Object.keys(RULE_PRESETS).forEach(name => {
        $('#bf_validator_rule_presets').append(
            `<button class="bf-validator-preset-btn" data-rule="${escapeHtml(name)}">${escapeHtml(name)}</button>`
        );
    });

    $('#bf_validator_rule_presets').on('click', '.bf-validator-preset-btn', function () {
        const ruleName = $(this).data('rule');
        addRuleFromPreset(ruleName);
    });

    // Custom rule button
    $('#bf_validator_add_custom_rule').on('click', function () {
        addCustomRule();
    });

    // Render initial rules
    renderRulesList();

    $('#bf_validator_quality_context').val(extensionSettings.qualityCheck.contextMessages).on('input', function () {
        const val = parseInt($(this).val());
        extensionSettings.qualityCheck.contextMessages = val;
        $('#bf_validator_quality_context_val').text(val);
        saveSettings();
    });

    $('#bf_validator_quality_feedback').val(extensionSettings.qualityCheck.feedbackTemplate || getDefaultQualityFeedbackTemplate()).on('change', function () {
        const val = $(this).val().trim();
        extensionSettings.qualityCheck.feedbackTemplate = (val === getDefaultQualityFeedbackTemplate()) ? '' : val;
        saveSettings();
    });

    $('#bf_validator_reset_quality_prompt').on('click', function () {
        extensionSettings.qualityCheck.prompt = DEFAULT_QUALITY_PROMPT;
        $('#bf_validator_quality_prompt').val(DEFAULT_QUALITY_PROMPT);
        saveSettings();
        toastr.info('Quality prompt reset to default', 'BF Validator');
    });

    $('#bf_validator_reset_quality_feedback').on('click', function () {
        extensionSettings.qualityCheck.feedbackTemplate = '';
        $('#bf_validator_quality_feedback').val(getDefaultQualityFeedbackTemplate());
        saveSettings();
        toastr.info('Quality feedback reset to default', 'BF Validator');
    });

    // === General Settings ===
    $('#bf_validator_max_retries').val(extensionSettings.maxRetries).on('change', function () {
        let value = parseInt($(this).val());
        if (isNaN(value) || value < 1) value = 1;
        if (value > 5) value = 5;
        extensionSettings.maxRetries = value;
        $(this).val(value);
        saveSettings();
    });

    $('#bf_validator_show_toast').prop('checked', extensionSettings.showToast).on('change', function () {
        extensionSettings.showToast = $(this).prop('checked');
        saveSettings();
    });

    $('#bf_validator_debug').prop('checked', extensionSettings.debugMode).on('change', function () {
        extensionSettings.debugMode = $(this).prop('checked');
        $('#bf_validator_debug_panel').toggle(extensionSettings.debugMode);
        saveSettings();
    });

    $('#bf_validator_clear_debug').on('click', function () {
        debugLog = [];
        renderDebugLog();
    });

    $('#bf_validator_copy_debug').on('click', function () {
        copyLogsToClipboard();
    });

    $('#bf_validator_test').on('click', async function () {
        try {
            const { testValidation } = await import('./validator.js');
            await testValidation();
        } catch (err) {
            console.error('[BFValidator] Test error:', err);
            toastr.error(`Test error: ${err.message}`, 'BF Validator');
        }
    });

    // === Presets ===
    updatePresetDropdown();

    $('#bf_validator_preset_select').on('change', function () {
        loadPreset($(this).val());
    });

    $('#bf_validator_preset_save').on('click', function () {
        const selected = $('#bf_validator_preset_select').val();
        if (selected && selected !== 'Default') {
            // Overwrite selected preset
            savePreset(selected);
        } else {
            const name = prompt('Enter preset name:');
            if (name && name.trim()) {
                savePreset(name.trim());
            }
        }
    });

    $('#bf_validator_preset_new').on('click', function () {
        const name = prompt('Enter new preset name:');
        if (name && name.trim()) {
            savePreset(name.trim());
        }
    });

    $('#bf_validator_preset_delete').on('click', function () {
        const name = $('#bf_validator_preset_select').val();
        deletePreset(name);
    });

    // === Reset All ===
    $('#bf_validator_reset_all').on('click', function () {
        if (!confirm('Reset ALL validator settings to factory defaults? This cannot be undone.')) return;

        // Replace entire settings with fresh defaults
        const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        fresh.localCheck.clichePatterns = getDefaultClichePatterns();
        fresh.qualityCheck.savedPresets = JSON.parse(JSON.stringify(DEFAULT_FULL_PRESETS));

        Object.keys(fresh).forEach(key => {
            extensionSettings[key] = fresh[key];
        });

        saveSettings();
        refreshUI();
        updatePresetDropdown();
        updateFullPresetDropdown();
        toastr.success('All settings reset to defaults', 'BF Validator');
    });

    // === Initial State ===
    $('#bf_validator_settings_content').toggle(extensionSettings.enabled);
    $('#bf_validator_profile_section').toggle(extensionSettings.useValidatorProfile);
    $('#bf_validator_debug_panel').toggle(extensionSettings.debugMode);
    updateStatus('idle');

    // Setup tab navigation
    try {
        setupTabs();
    } catch (e) {
        console.error('[BFValidator] Tab setup error:', e);
    }

    console.log('[BFValidator] UI loaded');
}

/**
 * Deep merge defaults into target, preserving existing values
 */
function ensureDefaults(target, defaults) {
    for (const key of Object.keys(defaults)) {
        if (target[key] === undefined) {
            target[key] = JSON.parse(JSON.stringify(defaults[key]));
        } else if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])) {
            if (typeof target[key] !== 'object' || target[key] === null) {
                target[key] = {};
            }
            ensureDefaults(target[key], defaults[key]);
        }
    }
}

/**
 * Migrate old settings format to new format
 */
function migrateOldSettings(settings) {
    // If old settings had criteria at top level, move to qualityCheck
    if (settings.criteria && !settings.qualityCheck?.criteria) {
        if (!settings.qualityCheck) settings.qualityCheck = {};
        settings.qualityCheck.criteria = settings.criteria;
        delete settings.criteria;
    }

    // If old settings had correctionTemplate, keep it as quality feedback
    if (settings.correctionTemplate && !settings.qualityCheck?.feedbackTemplate) {
        if (!settings.qualityCheck) settings.qualityCheck = {};
        // Don't migrate the old correction template - the new format is different
    }
    delete settings.correctionTemplate;

    // Old validatorProfile without toggle -> enable toggle if profile was set
    if (settings.validatorProfile && settings.useValidatorProfile === undefined) {
        settings.useValidatorProfile = true;
    }

    // Migrate old criteria/oocInstruction to rules array
    if (settings.qualityCheck && settings.qualityCheck.criteria !== undefined && settings.qualityCheck.rules === undefined) {
        const oldCriteria = settings.qualityCheck.criteria || '';
        const oldOoc = settings.qualityCheck.oocInstruction || '';
        settings.qualityCheck.rules = [];

        if (oldCriteria.trim()) {
            settings.qualityCheck.rules.push({
                name: 'Custom',
                check: oldCriteria,
                ooc: oldOoc,
                enabled: true,
            });
        }

        delete settings.qualityCheck.criteria;
        delete settings.qualityCheck.oocInstruction;
    }

    // Clean up old fields if rules exist
    if (settings.qualityCheck?.rules !== undefined) {
        delete settings.qualityCheck.criteria;
        delete settings.qualityCheck.oocInstruction;
    }

    // Ensure savedPresets exists
    if (settings.qualityCheck && !settings.qualityCheck.savedPresets) {
        settings.qualityCheck.savedPresets = {};
    }

    // Migrate old prompt formats to current default
    if (settings.qualityCheck?.prompt) {
        const p = settings.qualityCheck.prompt;
        // Old format 1: used {qualityCriteria} placeholder
        // Old format 2: asked for JSON response with "failed" array
        if (p.includes('{qualityCriteria}') || p.includes('"failed"') || p.includes('"pass": true')) {
            settings.qualityCheck.prompt = DEFAULT_QUALITY_PROMPT;
        }
    }

    // Migrate old wordcount template to wordcount_max
    if (settings.localCheck?.feedbackTemplates?.wordcount !== undefined) {
        const old = settings.localCheck.feedbackTemplates.wordcount;
        if (old && !settings.localCheck.feedbackTemplates.wordcount_max) {
            settings.localCheck.feedbackTemplates.wordcount_max = old;
        }
        delete settings.localCheck.feedbackTemplates.wordcount;
    }

    // Migrate old cliche pattern format:
    // Old: clichePatterns: true/false (toggle), customClichePatterns: [] (user patterns only)
    // New: clichePatternsEnabled: true/false (toggle), clichePatterns: [...] (all patterns)
    if (settings.localCheck) {
        const lc = settings.localCheck;

        // Detect old format: clichePatterns is a boolean
        if (typeof lc.clichePatterns === 'boolean') {
            lc.clichePatternsEnabled = lc.clichePatterns;
            // Merge defaults + custom into the unified list
            const customs = lc.customClichePatterns || [];
            lc.clichePatterns = [...getDefaultClichePatterns(), ...customs];
            delete lc.customClichePatterns;
        }

        // Also clean up leftover customClichePatterns if clichePatterns is already an array
        if (Array.isArray(lc.clichePatterns) && Array.isArray(lc.customClichePatterns)) {
            // Merge any remaining custom patterns not yet in the list
            for (const p of lc.customClichePatterns) {
                if (!lc.clichePatterns.includes(p)) {
                    lc.clichePatterns.push(p);
                }
            }
            delete lc.customClichePatterns;
        }
    }
}

/**
 * Initialize settings module
 */
export async function initSettings() {
    const context = SillyTavern.getContext();

    // Load or initialize settings
    extensionSettings = context.extensionSettings[EXTENSION_NAME] || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    // Migrate old format
    migrateOldSettings(extensionSettings);

    // Ensure all properties exist (deep merge)
    ensureDefaults(extensionSettings, DEFAULT_SETTINGS);

    // Populate cliche patterns with defaults if not yet initialized
    if (!extensionSettings.localCheck.clichePatterns || !Array.isArray(extensionSettings.localCheck.clichePatterns)) {
        extensionSettings.localCheck.clichePatterns = getDefaultClichePatterns();
    }

    // Seed default full presets if savedPresets is empty
    if (!extensionSettings.qualityCheck.savedPresets || Object.keys(extensionSettings.qualityCheck.savedPresets).length === 0) {
        extensionSettings.qualityCheck.savedPresets = JSON.parse(JSON.stringify(DEFAULT_FULL_PRESETS));
    }

    // Save back to ensure all properties exist
    context.extensionSettings[EXTENSION_NAME] = extensionSettings;
    context.saveSettingsDebounced();

    await loadUI();
    console.log('[BFValidator] Settings initialized');
}
