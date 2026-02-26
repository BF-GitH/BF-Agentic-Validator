// BF's Agentic Response Validator - Main Entry Point
// Validates LLM responses against user-defined criteria using a 3-stage pipeline

export const extension_name = 'bf-agentic-validator';

jQuery(async () => {
    try {
        const { initSettings } = await import('./src/settings.js');
        await initSettings();

        const { initValidator } = await import('./src/validator.js');
        initValidator();

        const { initSelectionHandler } = await import('./src/selection-handler.js');
        initSelectionHandler();

        console.log('[BFValidator] Extension loaded successfully');
    } catch (error) {
        console.error('[BFValidator] Failed to load extension:', error);
    }
});
